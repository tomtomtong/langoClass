const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const videoCaptions = require("./video-captions");

const DEFAULT_TARGET_BYTES = 12 * 1024 * 1024;

function runCommand(bin, args, { timeoutMs = 600000 } = {}) {
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

function rimrafDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function compressMaterialVideoBuffer(
  buffer,
  maxBytes = DEFAULT_TARGET_BYTES,
  { filename = "video.mp4" } = {}
) {
  if (!buffer?.length || buffer.length <= maxBytes) {
    return { buffer, mime: "video/mp4", compressed: false, originalBytes: buffer?.length || 0 };
  }
  if (!(await videoCaptions.ffmpegAvailable())) {
    return { buffer, mime: "video/mp4", compressed: false, originalBytes: buffer.length };
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mat-vid-"));
  const ext = path.extname(String(filename || "")).toLowerCase() || ".mp4";
  const inputPath = path.join(workDir, `input${ext}`);
  const outputPath = path.join(workDir, "output.mp4");

  try {
    fs.writeFileSync(inputPath, buffer);

    let crf = 32;
    let maxHeight = 720;
    let bestBuffer = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await runCommand(
        "ffmpeg",
        [
          "-y",
          "-i",
          inputPath,
          "-vf",
          `scale=-2:min(${maxHeight}\\,ih)`,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
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
          outputPath,
        ],
        { timeoutMs: 900000 }
      );

      const out = fs.readFileSync(outputPath);
      if (!bestBuffer || out.length < bestBuffer.length) bestBuffer = out;
      if (out.length <= maxBytes) {
        return {
          buffer: out,
          mime: "video/mp4",
          compressed: true,
          originalBytes: buffer.length,
        };
      }

      crf = Math.min(40, crf + 2);
      maxHeight = Math.max(360, Math.round(maxHeight * 0.82));
    }

    if (bestBuffer && bestBuffer.length < buffer.length) {
      return {
        buffer: bestBuffer,
        mime: "video/mp4",
        compressed: true,
        originalBytes: buffer.length,
      };
    }

    return { buffer, mime: "video/mp4", compressed: false, originalBytes: buffer.length };
  } finally {
    rimrafDir(workDir);
  }
}

module.exports = {
  DEFAULT_TARGET_BYTES,
  compressMaterialVideoBuffer,
};
