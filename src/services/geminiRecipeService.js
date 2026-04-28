const fsp = require("fs/promises");
const { GoogleGenerativeAI } = require("@google/generative-ai");

function getModelCandidates() {
  return [
    process.env.GEMINI_MODEL,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite"
  ].filter(Boolean);
}

function createGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

function safeJsonParse(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty model response.");
  try {
    return JSON.parse(raw);
  } catch {
    const markdownJsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (markdownJsonMatch) {
      return JSON.parse(markdownJsonMatch[1]);
    }
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Model response was not valid JSON.");
  }
}

function clampDifficulty(v) {
  const s = String(v || "").toLowerCase();
  if (s === "easy" || s === "medium" || s === "hard") return s;
  return "medium";
}

function toNumber(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function sanitizeIngredient(item) {
  if (!item || typeof item !== "object") {
    return {
      name: "",
      amount: "",
      unit: "",
      gramsEstimate: "",
      optional: false,
      notes: ""
    };
  }
  return {
    name: String(item.name || "").slice(0, 200),
    amount: String(item.amount || "").slice(0, 80),
    unit: String(item.unit || "").slice(0, 40),
    gramsEstimate: String(item.gramsEstimate || item.quantity_estimate_grams || "").slice(0, 80),
    optional: Boolean(item.optional),
    notes: String(item.notes || "").slice(0, 300)
  };
}

function sanitizeStep(item) {
  if (!item || typeof item !== "object") {
    return {
      title: "",
      instruction: "",
      detail: "",
      tip: "",
      whyItMatters: "",
      estimatedMinutes: 0
    };
  }
  return {
    title: String(item.title || "").slice(0, 120),
    instruction: String(item.instruction || item.step || "").slice(0, 2000),
    detail: String(item.detail || "").slice(0, 2000),
    tip: String(item.tip || "").slice(0, 500),
    whyItMatters: String(item.whyItMatters || "").slice(0, 800),
    estimatedMinutes: Math.max(0, Math.round(toNumber(item.estimatedMinutes, 0)))
  };
}

function validateAndSanitizeRecipe(raw, sourceUrl = "") {
  const o = raw && typeof raw === "object" ? raw : {};
  const ingredients = Array.isArray(o.ingredients)
    ? o.ingredients.map(sanitizeIngredient).filter((i) => i.name.trim())
    : [];
  const equipment = Array.isArray(o.equipment)
    ? o.equipment.map((e) => String(e || "").trim()).filter(Boolean).slice(0, 40)
    : [];
  const steps = Array.isArray(o.steps) ? o.steps.map(sanitizeStep).filter((s) => s.instruction.trim()) : [];
  const tags = Array.isArray(o.tags)
    ? o.tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 24)
    : [];

  let prep = Math.max(0, Math.round(toNumber(o.prepTimeMinutes, 0)));
  let cook = Math.max(0, Math.round(toNumber(o.cookTimeMinutes, 0)));
  let total = Math.max(0, Math.round(toNumber(o.totalTimeMinutes, 0)));
  if (!total && (prep || cook)) total = prep + cook;

  return {
    title: String(o.title || "Untitled recipe").slice(0, 200),
    description: String(o.description || "").slice(0, 4000),
    cuisine: String(o.cuisine || "").slice(0, 80),
    difficulty: clampDifficulty(o.difficulty),
    prepTimeMinutes: prep,
    cookTimeMinutes: cook,
    totalTimeMinutes: total,
    servings: Math.max(1, Math.round(toNumber(o.servings, 2)) || 2),
    ingredients,
    equipment,
    steps,
    tags,
    foodContent: o.foodContent !== false,
    confidence: Math.min(1, Math.max(0, toNumber(o.confidence, 0))),
    sourceType: o.sourceType ? String(o.sourceType).slice(0, 40) : "video_import",
    sourceUrl: sourceUrl ? String(sourceUrl).slice(0, 2000) : String(o.sourceUrl || "").slice(0, 2000)
  };
}

async function runWithModels(genAI, parts, options = {}) {
  const { jsonMode = false } = options;
  const modelErrors = [];
  for (const modelName of getModelCandidates()) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: jsonMode
          ? {
              responseMimeType: "application/json"
            }
          : undefined
      });
      const response = await model.generateContent(parts);
      const text = response.response.text() || "";
      return { text, modelName };
    } catch (error) {
      modelErrors.push(`${modelName}: ${error && error.message ? error.message : "error"}`);
    }
  }
  throw new Error("No compatible Gemini model succeeded. Tried: " + modelErrors.join(" | "));
}

async function transcribeAudio(genAI, audioPath) {
  if (!genAI) return "";
  try {
    const audioBase64 = (await fsp.readFile(audioPath)).toString("base64");
    const parts = [
      "Transcribe this audio to plain text. Return only transcription text with no formatting.",
      { inlineData: { mimeType: "audio/mpeg", data: audioBase64 } }
    ];
    const { text } = await runWithModels(genAI, parts);
    return text.trim();
  } catch {
    return "";
  }
}

const STRUCTURED_PROMPT = `You are an expert recipe writer and food-vision analyst.
Prioritize visual evidence from the provided video frames over transcript text.
Transcript is secondary context and may be incomplete or noisy.

Return ONLY a single JSON object (no markdown, no code fences, no commentary before or after).
Use this exact key set and types:
{
  "title": string,
  "description": string,
  "cuisine": string,
  "difficulty": "easy" | "medium" | "hard",
  "prepTimeMinutes": number,
  "cookTimeMinutes": number,
  "totalTimeMinutes": number,
  "servings": number,
  "ingredients": [
    {
      "name": string,
      "amount": string,
      "unit": string,
      "gramsEstimate": string,
      "optional": boolean,
      "notes": string
    }
  ],
  "equipment": string[],
  "steps": [
    {
      "title": string,
      "instruction": string,
      "detail": string,
      "tip": string,
      "whyItMatters": string,
      "estimatedMinutes": number
    }
  ],
  "tags": string[],
  "foodContent": boolean,
  "confidence": number,
  "sourceType": "video_import",
  "sourceUrl": string
}

Rules:
- If the video is not clearly about preparing food or drink, set foodContent to false, keep confidence low, and still return best-effort structured fields (they may be empty arrays).
- Infer realistic steps (usually 4–10) with clear instructions; include optional detail, tip, and whyItMatters when helpful.
- Ingredients should reflect what you can reasonably see or infer; note uncertainty briefly in ingredient.notes when needed.
- Never include labels like "frames" or "transcript" in user-facing strings.
- Never output markdown. JSON only.`;

async function generateStructuredRecipeFromFrames(genAI, framePaths, transcriptText, sourceUrl) {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY not found in environment.");
  }
  const parts = [
    `${STRUCTURED_PROMPT}\nTranscript context: ${transcriptText || "No transcript available."}\nsourceUrl: ${sourceUrl || ""}`
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

  let text;
  try {
    ({ text } = await runWithModels(genAI, parts, { jsonMode: true }));
  } catch {
    ({ text } = await runWithModels(genAI, parts, { jsonMode: false }));
  }
  const parsed = safeJsonParse(text);
  return validateAndSanitizeRecipe(parsed, sourceUrl);
}

async function refineRecipeWithGemini(genAI, draft, transcriptText, sourceUrl) {
  if (!genAI) return draft;
  const prompt = `You repair and normalize recipe JSON. Input may be incomplete or invalid.
Return ONLY JSON (no markdown) with the same schema as this example shape:
{
  "title": "",
  "description": "",
  "cuisine": "",
  "difficulty": "easy|medium|hard",
  "prepTimeMinutes": 0,
  "cookTimeMinutes": 0,
  "totalTimeMinutes": 0,
  "servings": 2,
  "ingredients": [{"name":"","amount":"","unit":"","gramsEstimate":"","optional":false,"notes":""}],
  "equipment": [""],
  "steps": [{"title":"","instruction":"","detail":"","tip":"","whyItMatters":"","estimatedMinutes":0}],
  "tags": [],
  "foodContent": true,
  "confidence": 0.0,
  "sourceType": "video_import",
  "sourceUrl": ""
}

Transcript: ${transcriptText || "None"}
Source URL: ${sourceUrl || ""}
Draft JSON to fix: ${JSON.stringify(draft).slice(0, 12000)}`;

  try {
    const { text } = await runWithModels(genAI, prompt, { jsonMode: true });
    const parsed = safeJsonParse(text);
    return validateAndSanitizeRecipe(parsed, sourceUrl);
  } catch {
    return validateAndSanitizeRecipe(draft, sourceUrl);
  }
}

function buildLegacyAnalysisFromRecipe(recipe) {
  const ingredients = (recipe.ingredients || []).map((i) => ({
    name: i.name,
    quantity_estimate: [i.amount, i.unit].filter(Boolean).join(" ").trim() || "estimate",
    quantity_estimate_grams: i.gramsEstimate || "",
    evidence: i.notes || ""
  }));

  const cooking_instructions = (recipe.steps || []).map((s) => ({
    step: s.title ? `${s.title}: ${s.instruction}` : s.instruction,
    detail: s.detail || "",
    tip: s.tip || ""
  }));

  return {
    food_content: recipe.foodContent,
    confidence: recipe.confidence,
    ingredients,
    cooking_instructions,
    notes: recipe.description ? recipe.description.slice(0, 1200) : ""
  };
}

module.exports = {
  createGenAI,
  getModelCandidates,
  runWithModels,
  safeJsonParse,
  validateAndSanitizeRecipe,
  transcribeAudio,
  generateStructuredRecipeFromFrames,
  refineRecipeWithGemini,
  buildLegacyAnalysisFromRecipe
};
