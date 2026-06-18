const fs = require("fs");
const paths = require("./paths");

const DEFAULT_SETTINGS = {
  publicBaseUrl: "",
  inworldApiKey: "",
  inworldLlmModel: "",
  qwenApiKey: "",
  qwenModel: "",
};

function readSettings() {
  paths.ensurePersistentDirs();
  const file = paths.appSettingsFile;
  if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const publicBaseUrl =
      typeof parsed.publicBaseUrl === "string"
        ? parsed.publicBaseUrl.trim().replace(/\/$/, "")
        : "";
    const inworldApiKey =
      typeof parsed.inworldApiKey === "string" ? parsed.inworldApiKey.trim() : "";
    const inworldLlmModel =
      typeof parsed.inworldLlmModel === "string" ? parsed.inworldLlmModel.trim() : "";
    const qwenApiKey = typeof parsed.qwenApiKey === "string" ? parsed.qwenApiKey.trim() : "";
    const qwenModel = typeof parsed.qwenModel === "string" ? parsed.qwenModel.trim() : "";
    return { publicBaseUrl, inworldApiKey, inworldLlmModel, qwenApiKey, qwenModel };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(partial) {
  const current = readSettings();
  const next = { ...current, ...partial };

  if (typeof next.publicBaseUrl === "string") {
    next.publicBaseUrl = next.publicBaseUrl.trim().replace(/\/$/, "");
  }

  if (typeof next.inworldApiKey === "string") {
    next.inworldApiKey = next.inworldApiKey.trim();
  }

  if (typeof next.inworldLlmModel === "string") {
    next.inworldLlmModel = next.inworldLlmModel.trim();
  }

  if (typeof next.qwenApiKey === "string") {
    next.qwenApiKey = next.qwenApiKey.trim();
  }

  if (typeof next.qwenModel === "string") {
    next.qwenModel = next.qwenModel.trim();
  }

  fs.writeFileSync(paths.appSettingsFile, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { readSettings, writeSettings };
