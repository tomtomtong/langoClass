const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const {
  cuesToWebVtt,
  groupWordsIntoCues,
  normalizeWordTimestamps,
  parseWebVtt,
  syntheticWordsFromTranscript,
  translateWebVtt,
} = require("./webvtt");

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 25;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

function runCommand(bin, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = (stderr || stdout || "").trim().slice(-500);
      reject(new Error(`${bin} failed${detail ? `: ${detail}` : "."}`));
    });
  });
}

async function ffmpegAvailable() {
  try {
    await runCommand("ffmpeg", ["-version"], { timeoutMs: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function ytDlpAvailable() {
  try {
    await runCommand("yt-dlp", ["--version"], { timeoutMs: 10000 });
    return true;
  } catch {
    return false;
  }
}

function youtubeUnsupportedMessage() {
  return (
    "YouTube links cannot be downloaded with a plain URL fetch. " +
    "Install yt-dlp on this server (for example: brew install yt-dlp), " +
    "or upload the video file / paste a direct video URL ending in .mp4."
  );
}

async function downloadWithYtDlp(videoUrl, destPath) {
  const outTemplate = `${destPath}.%(ext)s`;
  await runCommand(
    "yt-dlp",
    [
      "--no-playlist",
      "-f",
      "best[ext=mp4]/best[ext=webm]/best",
      "-o",
      outTemplate,
      videoUrl,
    ],
    { timeoutMs: 600000 }
  );

  const dir = path.dirname(destPath);
  const base = path.basename(destPath);
  const downloaded = fs
    .readdirSync(dir)
    .find((name) => name.startsWith(`${base}.`) || name === base);
  if (!downloaded) {
    throw new Error("yt-dlp did not produce a downloadable video file.");
  }
  const downloadedPath = path.join(dir, downloaded);
  if (downloadedPath !== destPath) {
    fs.renameSync(downloadedPath, destPath);
  }
}

async function fetchYouTubeSubtitlesVtt(videoUrl, workDir, language) {
  try {
    await runCommand(
      "yt-dlp",
      [
        "--no-playlist",
        "--skip-download",
        "--write-auto-sub",
        "--write-sub",
        "--sub-lang",
        `${language},en`,
        "--sub-format",
        "vtt",
        "-o",
        path.join(workDir, "video.%(ext)s"),
        videoUrl,
      ],
      { timeoutMs: 180000 }
    );
  } catch {
    return null;
  }

  const vttName = fs.readdirSync(workDir).find((name) => /\.vtt$/i.test(name));
  if (!vttName) return null;
  const vttText = fs.readFileSync(path.join(workDir, vttName), "utf8");
  return parseWebVtt(vttText).length ? vttText : null;
}

function assertDownloadedVideoBuffer(buffer, { isYouTube = false } = {}) {
  const sniff = sniffBufferKind(buffer);
  if (sniff === "html") {
    throw new Error(
      isYouTube
        ? youtubeUnsupportedMessage()
        : "URL did not return a video file (got a web page). Upload the video or use a direct .mp4 link."
    );
  }
  if (sniff === "empty") {
    throw new Error("Downloaded video file is empty.");
  }
}

function rimrafDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function isYouTubeUrl(videoUrl) {
  try {
    const parsed = new URL(String(videoUrl || "").trim());
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function sniffBufferKind(buffer) {
  if (!buffer?.length) return "empty";
  const head = buffer.subarray(0, Math.min(32, buffer.length)).toString("utf8").replace(/\s+/g, " ").trim();
  if (/^<!DOCTYPE html|^<html/i.test(head)) return "html";
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "webm/mkv";
  if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return "mp4/iso";
  }
  if (buffer[0] === 0x47) return "mpeg-ts";
  return "unknown";
}

function resolveLocalUploadPath(videoUrl, uploadFilePath) {
  if (typeof uploadFilePath !== "function") return null;
  try {
    const parsed = new URL(videoUrl, "http://localhost");
    if (parsed.pathname.startsWith("/uploads/")) {
      return uploadFilePath(parsed.pathname);
    }
  } catch {
    /* ignore */
  }
  if (String(videoUrl).startsWith("/uploads/")) {
    return uploadFilePath(videoUrl);
  }
  return null;
}

async function downloadVideoToFile(videoUrl, destPath, uploadFilePath) {
  const localPath = resolveLocalUploadPath(videoUrl, uploadFilePath);
  if (localPath && fs.existsSync(localPath)) {
    fs.copyFileSync(localPath, destPath);
    return;
  }

  if (isYouTubeUrl(videoUrl)) {
    if (!(await ytDlpAvailable())) {
      throw new Error(youtubeUnsupportedMessage());
    }
    await downloadWithYtDlp(videoUrl, destPath);
    assertDownloadedVideoBuffer(fs.readFileSync(destPath), { isYouTube: true });
    return;
  }

  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Could not download video (${res.status}).`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > MAX_VIDEO_BYTES) {
    throw new Error("Video is too large to generate captions (max 250MB).");
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  assertDownloadedVideoBuffer(buffer);
  if (buffer.length > MAX_VIDEO_BYTES) {
    throw new Error("Video is too large to generate captions (max 250MB).");
  }
  fs.writeFileSync(destPath, buffer);
}

async function extractAudioChunks(videoPath, workDir) {
  const pattern = path.join(workDir, "chunk-%03d.wav");
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_SECONDS),
      "-reset_timestamps",
      "1",
      pattern,
    ],
    { timeoutMs: 300000 }
  );

  return fs
    .readdirSync(workDir)
    .filter((name) => /^chunk-\d+\.wav$/i.test(name))
    .sort()
    .map((name) => path.join(workDir, name));
}

function wavDurationMs(filePath) {
  const stat = fs.statSync(filePath);
  // PCM s16le mono @ 16kHz plus typical 44-byte header.
  const dataBytes = Math.max(0, stat.size - 44);
  return Math.round((dataBytes / 2 / SAMPLE_RATE) * 1000);
}

async function writeCaptionVttFile(captionsDir, vttText) {
  fs.mkdirSync(captionsDir, { recursive: true });
  const filename = `captions-${Date.now()}-${randomUUID().slice(0, 8)}.vtt`;
  const outPath = path.join(captionsDir, filename);
  fs.writeFileSync(outPath, String(vttText || "").trim() + "\n", "utf8");
  return {
    captionUrl: `/uploads/captions/${filename}`,
    filename,
  };
}

/**
 * Download/extract video audio, STT each chunk, write a WebVTT file.
 * @param {{
 *   videoUrl: string,
 *   language?: string,
 *   captionsDir: string,
 *   uploadFilePath?: (url: string) => string | null,
 *   transcribeChunk: (audioBase64: string, format: string, meta: { language: string, offsetMs: number, durationMs: number }) => Promise<{ transcript: string, words?: Array<any> }>,
 * }} options
 */
async function generateVideoCaptions(options) {
  const videoUrl = String(options.videoUrl || "").trim();
  const language = String(options.language || "en").trim() || "en";
  const captionsDir = options.captionsDir;
  const transcribeChunk = options.transcribeChunk;

  if (!videoUrl) throw new Error("Video URL is required.");
  if (!captionsDir) throw new Error("Captions directory is required.");
  if (typeof transcribeChunk !== "function") {
    throw new Error("Transcription function is required.");
  }
  if (!(await ffmpegAvailable())) {
    throw new Error("ffmpeg is not installed on this server.");
  }

  fs.mkdirSync(captionsDir, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lango-captions-"));
  const videoPath = path.join(workDir, "source-video");

  try {
    if (isYouTubeUrl(videoUrl) && (await ytDlpAvailable())) {
      const subtitleVtt = await fetchYouTubeSubtitlesVtt(videoUrl, workDir, language);
      if (subtitleVtt) {
        const saved = await writeCaptionVttFile(captionsDir, subtitleVtt);
        return {
          captionUrl: saved.captionUrl,
          cueCount: parseWebVtt(subtitleVtt).length,
          wordCount: 0,
        };
      }
    }

    await downloadVideoToFile(videoUrl, videoPath, options.uploadFilePath);
    const chunkPaths = await extractAudioChunks(videoPath, workDir);
    if (!chunkPaths.length) {
      throw new Error("No audio track found in this video.");
    }

    const allWords = [];
    let offsetMs = 0;

    for (const chunkPath of chunkPaths) {
      const durationMs = wavDurationMs(chunkPath);
      const audioBase64 = fs.readFileSync(chunkPath).toString("base64");
      const result = await transcribeChunk(audioBase64, "wav", {
        language,
        offsetMs,
        durationMs,
      });

      const timedWords = normalizeWordTimestamps(result?.words, offsetMs);
      if (timedWords.length) {
        allWords.push(...timedWords);
      } else if (result?.transcript) {
        allWords.push(...syntheticWordsFromTranscript(result.transcript, offsetMs, durationMs));
      }

      offsetMs += durationMs || CHUNK_SECONDS * 1000;
    }

    const cues = groupWordsIntoCues(allWords).filter((cue) => cue.text);
    if (!cues.length) {
      throw new Error("STT returned no speech for this video.");
    }

    const filename = `captions-${Date.now()}-${randomUUID().slice(0, 8)}.vtt`;
    const outPath = path.join(captionsDir, filename);
    fs.writeFileSync(outPath, cuesToWebVtt(cues), "utf8");

    return {
      captionUrl: `/uploads/captions/${filename}`,
      cueCount: cues.length,
      wordCount: allWords.length,
    };
  } finally {
    rimrafDir(workDir);
  }
}

module.exports = {
  SAMPLE_RATE,
  CHUNK_SECONDS,
  ffmpegAvailable,
  ytDlpAvailable,
  isYouTubeUrl,
  generateVideoCaptions,
  cuesToWebVtt,
  groupWordsIntoCues,
  normalizeWordTimestamps,
  syntheticWordsFromTranscript,
  parseWebVtt,
  translateWebVtt,
  writeCaptionVttFile,
};
