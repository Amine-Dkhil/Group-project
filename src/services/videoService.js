const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ytdl = require("@distube/ytdl-core");
const ytDlp = require("yt-dlp-exec");

const TEMP_ROOT = path.join(__dirname, "..", "..", "temp");

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

function isYouTubeUrl(url) {
  try {
    return ytdl.validateURL(url);
  } catch {
    return false;
  }
}

function youtubeVideoId(url) {
  return ytdl.getURLVideoID(url);
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
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

async function cleanupDir(dirPath) {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function createJobPaths() {
  const jobId = crypto.randomUUID();
  const jobDir = path.join(TEMP_ROOT, jobId);
  const videoPath = path.join(jobDir, "video.mp4");
  const audioPath = path.join(jobDir, "audio.mp3");
  const framesDir = path.join(jobDir, "frames");
  return { jobId, jobDir, videoPath, audioPath, framesDir };
}

async function downloadVideoToJob(videoUrl, videoPath) {
  if (isYouTubeUrl(videoUrl)) {
    youtubeVideoId(videoUrl);
    await downloadYouTubeVideo(videoUrl, videoPath);
  } else {
    await downloadDirectVideo(videoUrl, videoPath);
  }
}

module.exports = {
  TEMP_ROOT,
  isYouTubeUrl,
  youtubeVideoId,
  ensureDir,
  downloadYouTubeVideo,
  downloadDirectVideo,
  extractAudio,
  extractFrames,
  cleanupDir,
  createJobPaths,
  downloadVideoToJob
};
