require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ytdl = require("@distube/ytdl-core");
const ytDlp = require("yt-dlp-exec");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("GEMINI_API_KEY is missing in .env");
}
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const modelCandidates = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite"
].filter(Boolean);

const TEMP_ROOT = path.join(__dirname, "temp");
const ingredientImageCache = new Map();
const preferGeneratedIngredientImages =
  (process.env.PREFER_GENERATED_INGREDIENT_IMAGES || "true").toLowerCase() !== "false";

function isYouTubeUrl(url) {
  try {
    return ytdl.validateURL(url);
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

function youtubeVideoId(url) {
  return ytdl.getURLVideoID(url);
}

async function downloadYouTubeVideo(url, outputPath) {
  await ytDlp(url, {
    output: outputPath,
    format: "bv*+ba/b",
    mergeOutputFormat: "mp4",
    noPlaylist: true,
    noWarnings: true
  });
}

async function downloadDirectVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Video fetch failed with status ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(outputPath, buffer);
}

async function extractAudio(videoPath, audioPath) {
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .save(audioPath)
      .on("end", resolve)
      .on("error", reject);
  });
}

async function transcribeAudio(audioPath) {
  if (!genAI) return "";
  try {
    const audioBase64 = (await fsp.readFile(audioPath)).toString("base64");
    for (const modelName of modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([
          "Transcribe this audio to plain text. Return only transcription text with no formatting.",
          { inlineData: { mimeType: "audio/mpeg", data: audioBase64 } }
        ]);
        return result.response.text().trim();
      } catch {
        // Try next available model for this key/account.
      }
    }
    return "";
  } catch {
    return "";
  }
}

async function extractFrames(videoPath, framesDir) {
  await ensureDir(framesDir);
  const framePattern = path.join(framesDir, "frame-%03d.jpg");
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(["-vf", "fps=1/3", "-frames:v", "12", "-q:v", "2"])
      .output(framePattern)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
  const entries = await fsp.readdir(framesDir);
  return entries.filter((name) => name.endsWith(".jpg")).map((name) => path.join(framesDir, name));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const markdownJsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (markdownJsonMatch) {
      return JSON.parse(markdownJsonMatch[1]);
    }

    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Model response was not valid JSON.");
  }
}

async function analyzeFoodFromFramesAndTranscript(framePaths, transcriptText) {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY not found in environment.");
  }
  const parts = [
    "You are a precise food-vision analyst. Prioritize visual evidence from frames over transcript text. " +
      "Analyze this video for food content. Return strict JSON with keys: " +
      "food_content (boolean), confidence (0-1), ingredients (array of {name, quantity_estimate, quantity_estimate_grams, evidence}), " +
      "cooking_instructions (array of step objects {step, detail, tip}), notes (string). " +
      "For quantity_estimate use practical measures when possible (e.g. '2 eggs', '1 tbsp oil'). " +
      "quantity_estimate_grams must be a concise gram estimate string (e.g. '30 g', '150-200 g'). " +
      "For cooking_instructions, infer sequence from frames and transcript. Keep 4-8 concise, actionable steps with friendly language. " +
      "Include short detail and useful tip for each step. Do not include source labels like frames/transcript/both in any output field. " +
      "Do not mention frame numbers anywhere. " +
      `Transcript context: ${transcriptText || "No transcript available."}`
  ];

  for (const framePath of framePaths) {
    const b64 = (await fsp.readFile(framePath)).toString("base64");
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: b64
      }
    });
  }

  const modelErrors = [];
  for (const modelName of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const response = await model.generateContent(parts);
      const output = response.response.text() || "{}";
      return safeJsonParse(output);
    } catch (error) {
      modelErrors.push(
        `${modelName}: ${error && error.message ? error.message : "Unknown model error"}`
      );
    }
  }

  throw new Error(
    "No compatible Gemini model succeeded. Tried: " + modelErrors.join(" | ")
  );
}

async function cleanupDir(dirPath) {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function ingredientPlaceholderDataUrl(name) {
  const label = (name || "Ingredient").replace(/&/g, "and").slice(0, 32);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">` +
    `<rect width="100%" height="100%" fill="#e6edf7"/>` +
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
    `font-family="Arial, sans-serif" font-size="34" fill="#2f4b6f">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function hashString(input) {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function normalizeIngredientForImagePrompt(name) {
  const key = (name || "").trim().toLowerCase();
  const map = {
    corn: "sweet corn kernels",
    "corn kernels": "sweet corn kernels",
    "ground beef": "raw ground beef",
    "ground meat": "raw ground beef",
    "black beans": "black beans in a small bowl",
    "cooking oil": "olive oil bottle",
    salsa: "red salsa in a small bowl",
    onion: "whole yellow onion"
  };
  return map[key] || key || "ingredient";
}

function buildGeneratedIngredientImageUrl(name, variant = 0) {
  const ingredient = normalizeIngredientForImagePrompt(name);
  const prompt =
    `minimal studio product photo of only one ingredient: ${ingredient}, isolated on pure white background, ` +
    "soft lighting, centered, realistic, simple composition, no text, no watermark, no logo, no plate, no hands";
  const seed = hashString(`${ingredient.toLowerCase()}-${variant}`);
  return (
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=640&height=640&seed=${seed}&nologo=true`
  );
}

async function isReachableImageUrl(url) {
  try {
    let response = await fetch(url, { method: "HEAD" });
    let contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("image")) return true;

    if (response.status === 405 || response.status === 403 || response.status === 400) {
      response = await fetch(url, { method: "GET" });
      contentType = response.headers.get("content-type") || "";
      return response.ok && contentType.includes("image");
    }

    return false;
  } catch {
    return false;
  }
}

async function resolveIngredientImageUrl(name) {
  const cacheKey = (name || "").trim().toLowerCase();
  if (!cacheKey) return ingredientPlaceholderDataUrl("Ingredient");
  if (ingredientImageCache.has(cacheKey)) return ingredientImageCache.get(cacheKey);

  if (preferGeneratedIngredientImages) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generatedUrl = buildGeneratedIngredientImageUrl(name, attempt);
      if (await isReachableImageUrl(generatedUrl)) {
        ingredientImageCache.set(cacheKey, generatedUrl);
        return generatedUrl;
      }
    }
  }

  const normalized = cacheKey
    .replace(/\(.*?\)/g, "")
    .replace(/fresh|dried|chopped|diced|shredded|ground|minced|kernels|powder/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const keywordMap = {
    "ground meat": "beef",
    "minced meat": "beef",
    "black beans": "black beans",
    "cooking oil": "olive oil",
    "green herbs": "parsley"
  };
  const baseName = keywordMap[cacheKey] || keywordMap[normalized] || normalized || cacheKey;
  const shortName = baseName.split(" ").slice(-1)[0];
  const mealDbCandidates = [...new Set([baseName, shortName])];

  for (const candidate of mealDbCandidates) {
    const mealDbUrl = `https://www.themealdb.com/images/ingredients/${encodeURIComponent(candidate)}.png`;
    if (await isReachableImageUrl(mealDbUrl)) {
      ingredientImageCache.set(cacheKey, mealDbUrl);
      return mealDbUrl;
    }
  }

  const wikiUrl =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search" +
    `&gsrsearch=${encodeURIComponent(`${name} food ingredient`)}` +
    "&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=600";

  try {
    const response = await fetch(wikiUrl);
    if (!response.ok) throw new Error("Image provider request failed.");
    const data = await response.json();
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    const thumb = pages[0]?.thumbnail?.source;
    if (thumb && (await isReachableImageUrl(thumb))) {
      ingredientImageCache.set(cacheKey, thumb);
      return thumb;
    }
  } catch {
    // Fall through to placeholder fallback.
  }

  const fallback = ingredientPlaceholderDataUrl(name);
  ingredientImageCache.set(cacheKey, fallback);
  return fallback;
}

app.post("/api/analyze", async (req, res) => {
  const { videoUrl } = req.body || {};
  if (!videoUrl || typeof videoUrl !== "string") {
    return res.status(400).json({ error: "videoUrl is required." });
  }
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not found in environment." });
  }

  const jobId = crypto.randomUUID();
  const jobDir = path.join(TEMP_ROOT, jobId);
  const videoPath = path.join(jobDir, "video.mp4");
  const audioPath = path.join(jobDir, "audio.mp3");
  const framesDir = path.join(jobDir, "frames");

  try {
    await ensureDir(jobDir);

    let transcriptText = "";
    if (isYouTubeUrl(videoUrl)) {
      youtubeVideoId(videoUrl); // validates and throws for malformed links.
      await downloadYouTubeVideo(videoUrl, videoPath);
    } else {
      await downloadDirectVideo(videoUrl, videoPath);
    }

    await extractAudio(videoPath, audioPath);
    const transcribedText = await transcribeAudio(audioPath);
    const mergedTranscript = [transcriptText, transcribedText].filter(Boolean).join(" ");

    const framePaths = await extractFrames(videoPath, framesDir);
    if (!framePaths.length) {
      throw new Error("No frames extracted from the video.");
    }

    const analysis = await analyzeFoodFromFramesAndTranscript(framePaths, mergedTranscript);
    res.json({
      videoUrl,
      analyzedFrames: framePaths.length,
      transcriptUsed: Boolean(mergedTranscript),
      analysis
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Analysis failed." });
  } finally {
    await cleanupDir(jobDir);
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/ingredient-image", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name : "";
  const imageUrl = await resolveIngredientImageUrl(name);
  res.json({ name, imageUrl });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
