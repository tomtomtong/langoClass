const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 25;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const WORDS_PER_CUE = 10;
const MAX_CUE_MS = 4500;

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

function rimrafDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
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

  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Could not download video (${res.status}).`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > MAX_VIDEO_BYTES) {
    throw new Error("Video is too large to generate captions (max 250MB).");
  }

  const buffer = Buffer.from(await res.arrayBuffer());
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

function normalizeWordTimestamps(rawWords, offsetMs = 0) {
  return (Array.isArray(rawWords) ? rawWords : [])
    .map((entry) => {
      const word = String(entry?.word || "").trim();
      if (!word) return null;
      const startMs = Number(
        entry.startTimeMs ??
          (Number.isFinite(Number(entry.startTimeSeconds))
            ? Number(entry.startTimeSeconds) * 1000
            : entry.start ?? entry.start_ms ?? 0)
      );
      const endMs = Number(
        entry.endTimeMs ??
          (Number.isFinite(Number(entry.endTimeSeconds))
            ? Number(entry.endTimeSeconds) * 1000
            : entry.end ?? entry.end_ms ?? startMs + 300)
      );
      return {
        word,
        startMs: offsetMs + Math.max(0, startMs),
        endMs: offsetMs + Math.max(startMs + 40, endMs),
      };
    })
    .filter(Boolean);
}

function syntheticWordsFromTranscript(transcript, offsetMs, durationMs) {
  const parts = String(transcript || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length || durationMs <= 0) return [];

  const step = durationMs / parts.length;
  return parts.map((word, index) => {
    const startMs = Math.round(offsetMs + index * step);
    const endMs = Math.round(offsetMs + (index + 1) * step);
    return { word, startMs, endMs: Math.max(startMs + 40, endMs) };
  });
}

function groupWordsIntoCues(words) {
  const cues = [];
  let current = null;

  for (const word of words) {
    if (!current) {
      current = {
        startMs: word.startMs,
        endMs: word.endMs,
        words: [word.word],
      };
      continue;
    }

    const nextText = `${current.words.join(" ")} ${word.word}`;
    const gap = word.startMs - current.endMs;
    const span = word.endMs - current.startMs;
    const shouldBreak =
      current.words.length >= WORDS_PER_CUE ||
      span > MAX_CUE_MS ||
      gap > 900 ||
      /[.!?。！？]$/.test(current.words[current.words.length - 1] || "");

    if (shouldBreak) {
      cues.push(current);
      current = {
        startMs: word.startMs,
        endMs: word.endMs,
        words: [word.word],
      };
    } else {
      current.words.push(word.word);
      current.endMs = Math.max(current.endMs, word.endMs);
      // silence unused; nextText helps readability in debug only
      void nextText;
    }
  }

  if (current?.words?.length) cues.push(current);
  return cues.map((cue) => ({
    startMs: cue.startMs,
    endMs: Math.max(cue.endMs, cue.startMs + 400),
    text: cue.words.join(" ").replace(/\s+/g, " ").trim(),
  }));
}

function formatVttTimestamp(ms) {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function cuesToWebVtt(cues) {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue, index) => {
    if (!cue.text) return;
    lines.push(String(index + 1));
    lines.push(`${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return `${lines.join("\n").trim()}\n`;
}

function parseVttTimestamp(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const fraction = String(match[4] || "0").padEnd(3, "0").slice(0, 3);
  return hours * 3600 + minutes * 60 + seconds + Number(fraction) / 1000;
}

function parseWebVtt(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n");
  const cues = [];
  let index = 0;

  if (/^WEBVTT/i.test(lines[0] || "")) index = 1;

  while (index < lines.length) {
    while (index < lines.length && !String(lines[index] || "").trim()) index += 1;
    if (index >= lines.length) break;

    let line = String(lines[index] || "").trim();
    if (/^\d+$/.test(line)) {
      index += 1;
      line = String(lines[index] || "").trim();
    }

    const timing = line.match(
      /^((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/
    );
    if (!timing) {
      index += 1;
      continue;
    }

    const start = parseVttTimestamp(timing[1]);
    const end = parseVttTimestamp(timing[2]);
    index += 1;
    const textLines = [];
    while (index < lines.length && String(lines[index] || "").trim()) {
      textLines.push(String(lines[index]).trim());
      index += 1;
    }

    if (Number.isFinite(start) && Number.isFinite(end) && end > start && textLines.length) {
      cues.push({
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        text: textLines.join("\n"),
      });
    }
  }

  return cues;
}

function languageDisplayName(code) {
  const map = {
    en: "English",
    zh: "Simplified Chinese",
    yue: "Cantonese Chinese",
    ja: "Japanese",
    ko: "Korean",
  };
  return map[String(code || "").toLowerCase()] || String(code || "the target language");
}

/**
 * Translate cue texts with an LLM callback while preserving timings.
 * @param {string} vttText
 * @param {string} targetLanguage
 * @param {(messages: Array<{role:string, content:string}>, maxTokens: number) => Promise<string>} llmComplete
 */
async function translateWebVtt(vttText, targetLanguage, llmComplete) {
  const cues = parseWebVtt(vttText);
  if (!cues.length) throw new Error("Source captions have no cues to translate.");
  if (typeof llmComplete !== "function") throw new Error("LLM translate function is required.");

  const numbered = cues.map((cue, index) => `${index + 1}. ${cue.text}`).join("\n");
  const targetName = languageDisplayName(targetLanguage);
  const reply = await llmComplete(
    [
      {
        role: "system",
        content:
          "You translate video subtitle lines. Keep the same numbering and line count. Return only the translated numbered list. Do not add commentary.",
      },
      {
        role: "user",
        content: `Translate each subtitle line into ${targetName}. Keep meaning natural for learners. Preserve numbering exactly.\n\n${numbered}`,
      },
    ],
    Math.min(4000, 120 + cues.length * 40)
  );

  const translations = new Map();
  String(reply || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^(\d+)\s*[.、:)\-]\s*(.+)$/);
      if (!match) return;
      translations.set(Number(match[1]), match[2].trim());
    });

  const translatedCues = cues.map((cue, index) => ({
    ...cue,
    text: translations.get(index + 1) || cue.text,
  }));

  const translatedCount = translatedCues.filter(
    (cue, index) => cue.text !== cues[index].text
  ).length;
  if (!translatedCount) {
    throw new Error("Translation returned no usable subtitle lines.");
  }

  return cuesToWebVtt(translatedCues);
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
  generateVideoCaptions,
  cuesToWebVtt,
  groupWordsIntoCues,
  normalizeWordTimestamps,
  syntheticWordsFromTranscript,
  parseWebVtt,
  translateWebVtt,
  writeCaptionVttFile,
};
