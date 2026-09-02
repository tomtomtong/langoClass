const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

/** Bump when TTS provider, voice, model, or styling changes invalidate cached audio. */
const QUESTION_TTS_CACHE_VERSION = "2";

function questionTtsCacheDir() {
  return path.join(paths.dataDir, "question-tts");
}

function ensureQuestionTtsCacheDir() {
  const dir = questionTtsCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function buildQuestionTtsCacheKey({ text, speakLangCode, purpose = "question", meta = {} }) {
  const payload = JSON.stringify({
    v: QUESTION_TTS_CACHE_VERSION,
    text: String(text || "").trim(),
    speakLangCode: String(speakLangCode || "en").trim().toLowerCase(),
    purpose: String(purpose || "question").trim(),
    provider: String(meta.provider || "").trim(),
    model: String(meta.model || "").trim(),
    voice: String(meta.voice || "").trim(),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function cacheFilePath(cacheKey, format = "mp3") {
  const ext = String(format || "mp3")
    .trim()
    .toLowerCase()
    .replace(/^\./, "") || "mp3";
  return path.join(questionTtsCacheDir(), `${cacheKey}.${ext}`);
}

function loadCachedQuestionTts(cacheKey) {
  if (!cacheKey) return null;
  try {
    const mp3Path = cacheFilePath(cacheKey, "mp3");
    if (!fs.existsSync(mp3Path)) return null;
    const audioContent = fs.readFileSync(mp3Path).toString("base64");
    if (!audioContent) return null;
    return { audioContent, format: "mp3", cached: true };
  } catch {
    return null;
  }
}

function saveCachedQuestionTts(cacheKey, audioContent, format = "mp3") {
  const base64 = String(audioContent || "").trim();
  if (!cacheKey || !base64) return false;
  try {
    ensureQuestionTtsCacheDir();
    fs.writeFileSync(cacheFilePath(cacheKey, format), Buffer.from(base64, "base64"));
    return true;
  } catch (err) {
    console.warn(`[tts] Could not cache question audio: ${err.message || err}`);
    return false;
  }
}

module.exports = {
  QUESTION_TTS_CACHE_VERSION,
  buildQuestionTtsCacheKey,
  loadCachedQuestionTts,
  saveCachedQuestionTts,
  ensureQuestionTtsCacheDir,
};
