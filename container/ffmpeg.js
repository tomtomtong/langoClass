// ffmpeg work for the Worker: split a video or audio file into short MP3
// pieces for speech recognition, and shrink a lesson video the way
// lib/material-video-compress.js did on Node.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CHUNK_SECONDS = 25;
const SAMPLE_RATE = 16000;

function run(bin, args, timeoutMs) {
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
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const detail = (stderr || stdout || "").trim().slice(-500);
      reject(new Error(`${bin} failed${detail ? `: ${detail}` : "."}`));
    });
  });
}

async function withWorkDir(prefix, work) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function durationMs(file) {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    30000
  );
  const seconds = Number(String(stdout).trim());
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

// Returns [{ base64, format: "mp3", durationMs }] in playing order; an empty
// list when the file has no sound.
async function audioChunks(buffer, { seconds = CHUNK_SECONDS } = {}) {
  return withWorkDir("lango-chunks-", async (dir) => {
    const input = path.join(dir, "source");
    fs.writeFileSync(input, buffer);
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", input],
      30000
    ).catch((error) => {
      throw new Error(`Could not read this media file. ${error.message}`);
    });
    if (!String(stdout).trim()) return [];
    await run(
      "ffmpeg",
      [
        "-y",
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "48k",
        "-f",
        "segment",
        "-segment_time",
        String(seconds),
        "-reset_timestamps",
        "1",
        path.join(dir, "chunk-%04d.mp3"),
      ],
      600000
    );
    const names = fs
      .readdirSync(dir)
      .filter((name) => /^chunk-\d+\.mp3$/.test(name))
      .sort();
    const chunks = [];
    for (const name of names) {
      const file = path.join(dir, name);
      const bytes = fs.readFileSync(file);
      if (!bytes.length) continue;
      chunks.push({ base64: bytes.toString("base64"), format: "mp3", durationMs: (await durationMs(file)) || seconds * 1000 });
    }
    return chunks;
  });
}

// Same steps as Node: re-encode at falling quality until the file fits, and
// keep the original when nothing smaller comes out.
async function compressVideo(buffer, maxBytes, { filename = "video.mp4" } = {}) {
  if (!buffer.length || buffer.length <= maxBytes) return { buffer, compressed: false };
  return withWorkDir("lango-video-", async (dir) => {
    const ext = path.extname(String(filename || "")).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".mp4";
    const input = path.join(dir, `input${ext}`);
    const output = path.join(dir, "output.mp4");
    fs.writeFileSync(input, buffer);
    let crf = 32;
    let maxHeight = 720;
    let best = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await run(
        "ffmpeg",
        [
          "-y",
          "-i",
          input,
          "-vf",
          `scale=-2:min(${maxHeight}\\,ih)`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          String(crf),
          "-maxrate",
          "1200k",
          "-bufsize",
          "2400k",
          "-c:a",
          "aac",
          "-b:a",
          "64k",
          "-ac",
          "1",
          "-movflags",
          "+faststart",
          output,
        ],
        900000
      );
      const out = fs.readFileSync(output);
      if (!best || out.length < best.length) best = out;
      if (out.length <= maxBytes) return { buffer: out, compressed: true };
      crf = Math.min(40, crf + 2);
      maxHeight = Math.max(360, Math.round(maxHeight * 0.82));
    }
    if (best && best.length < buffer.length) return { buffer: best, compressed: true };
    return { buffer, compressed: false };
  });
}

module.exports = { CHUNK_SECONDS, audioChunks, compressVideo };
