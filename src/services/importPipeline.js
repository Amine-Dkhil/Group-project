const {
  createGenAI,
  transcribeAudio,
  generateStructuredRecipeFromFrames,
  refineRecipeWithGemini,
  buildLegacyAnalysisFromRecipe
} = require("./geminiRecipeService");
const {
  ensureDir,
  cleanupDir,
  createJobPaths,
  downloadVideoToJob,
  extractAudio,
  extractFrames
} = require("./videoService");

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function runVideoImportAnalysis(videoUrl) {
  if (!videoUrl || typeof videoUrl !== "string") {
    throw new Error("videoUrl is required.");
  }
  const trimmed = videoUrl.trim();
  if (!isHttpUrl(trimmed)) {
    throw new Error("Please provide a valid http(s) URL.");
  }

  const genAI = createGenAI();
  if (!genAI) {
    throw new Error("GEMINI_API_KEY not found in environment.");
  }

  const { jobDir, videoPath, audioPath, framesDir } = createJobPaths();
  await ensureDir(jobDir);

  try {
    await downloadVideoToJob(trimmed, videoPath);
    await extractAudio(videoPath, audioPath);
    const transcript = await transcribeAudio(genAI, audioPath);
    const framePaths = await extractFrames(videoPath, framesDir);
    if (!framePaths.length) {
      throw new Error("No frames extracted from the video.");
    }

    let recipeDraft = await generateStructuredRecipeFromFrames(genAI, framePaths, transcript, trimmed);

    const needsRefine =
      !recipeDraft.foodContent ||
      recipeDraft.steps.length < 2 ||
      recipeDraft.confidence < 0.35;

    if (needsRefine) {
      recipeDraft = await refineRecipeWithGemini(genAI, recipeDraft, transcript, trimmed);
    }

    const legacyAnalysis = buildLegacyAnalysisFromRecipe(recipeDraft);
    const warnings = [];
    if (!recipeDraft.foodContent) {
      warnings.push("Low confidence that this video is a cooking video. You can still edit and save a draft.");
    }

    return {
      videoUrl: trimmed,
      analyzedFrames: framePaths.length,
      transcriptUsed: Boolean(transcript),
      recipeDraft,
      legacyAnalysis,
      warnings
    };
  } finally {
    await cleanupDir(jobDir);
  }
}

module.exports = {
  runVideoImportAnalysis,
  isHttpUrl
};
