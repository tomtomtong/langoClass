// Material formats and text clean-up, without PDF, Word or zip libraries, so
// the Worker can use them. material-extract.js reads the files themselves.
const { parseWebVtt } = require("./webvtt");

const MAX_MATERIAL_CHARS = 12000;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".docx", ".pptx", ".vtt"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac", ".aac"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"]);
const SUPPORTED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateMaterial(text, maxChars = MAX_MATERIAL_CHARS) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false, originalLength: normalized.length };
  }
  return {
    text: `${normalized.slice(0, maxChars).trim()}\n\n[…truncated for generation]`,
    truncated: true,
    originalLength: normalized.length,
  };
}

function extensionFromName(filename) {
  const match = String(filename || "").toLowerCase().match(/(\.[^./\\]+)$/);
  return match ? match[1] : "";
}

function isAudioExtension(ext) {
  return AUDIO_EXTENSIONS.has(ext);
}

function isImageExtension(ext) {
  return IMAGE_EXTENSIONS.has(ext);
}

function isVideoExtension(ext) {
  return VIDEO_EXTENSIONS.has(ext);
}

function isVideoFormat(format, mimetype) {
  const mime = String(mimetype || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  if (mime.startsWith("audio/")) return false;
  return VIDEO_EXTENSIONS.has(`.${String(format || "").toLowerCase()}`);
}

function isAudioFormat(format, mimetype) {
  const mime = String(mimetype || "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  if (isVideoFormat(format, mimetype)) return false;
  return AUDIO_EXTENSIONS.has(`.${String(format || "").toLowerCase()}`);
}

function isImageFormat(format) {
  return IMAGE_EXTENSIONS.has(`.${String(format || "").toLowerCase()}`);
}

function isHeicLikeFormat(format, mimetype) {
  const normalized = String(format || "").toLowerCase();
  const mime = String(mimetype || "").toLowerCase();
  return (
    normalized === "heic" ||
    normalized === "heif" ||
    mime.includes("heic") ||
    mime.includes("heif")
  );
}

function imageMimeFromFormat(format, fallbackMime) {
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
  };
  const normalized = String(format || "").toLowerCase();
  if (map[normalized]) return map[normalized];
  const mime = String(fallbackMime || "").toLowerCase();
  if (mime.startsWith("image/")) return mime;
  return "image/jpeg";
}

function detectFormat(filename, mimetype) {
  const ext = extensionFromName(filename);
  if (SUPPORTED_EXTENSIONS.has(ext)) return ext.slice(1);
  const mime = String(mimetype || "").toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("wordprocessingml") || mime.includes("msword")) return "docx";
  if (mime.includes("presentationml")) return "pptx";
  if (mime.includes("text/plain")) return "txt";
  if (mime.includes("webvtt")) return "vtt";
  if (mime.startsWith("video/")) return ext.slice(1) || "mp4";
  if (mime.startsWith("audio/")) return ext.slice(1) || "mp3";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";
  if (mime.startsWith("image/")) return ext.slice(1) || "jpeg";
  return ext ? ext.slice(1) : "txt";
}

function extractVtt(text) {
  const cues = parseWebVtt(text);
  return normalizeWhitespace(cues.map((cue) => cue.text).join("\n"));
}

function extractPlainText(text) {
  return normalizeWhitespace(text);
}

module.exports = {
  MAX_MATERIAL_CHARS,
  TEXT_EXTENSIONS,
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  normalizeWhitespace,
  truncateMaterial,
  detectFormat,
  isAudioFormat,
  isImageFormat,
  isVideoFormat,
  isHeicLikeFormat,
  imageMimeFromFormat,
  extractVtt,
  extractPlainText,
};
