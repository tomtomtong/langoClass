const fs = require("fs");
const paths = require("./paths");

const DEFAULT_SETTINGS = {
  publicBaseUrl: "",
  inworldApiKey: "",
  inworldLlmModel: "",
  inworldSttModel: "",
  inworldSttLanguage: "",
  qwenApiKey: "",
  qwenModel: "",
  openrouterApiKey: "",
  openrouterBuzzinModel: "",
  openrouterGenerateModel: "",
  openrouterVisionModel: "",
  openrouterTtsModel: "",
  videoGeneratorApiUrl: "",
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
    const inworldSttModel =
      typeof parsed.inworldSttModel === "string" ? parsed.inworldSttModel.trim() : "";
    const inworldSttLanguage =
      typeof parsed.inworldSttLanguage === "string" ? parsed.inworldSttLanguage.trim() : "";
    const qwenApiKey = typeof parsed.qwenApiKey === "string" ? parsed.qwenApiKey.trim() : "";
    const qwenModel = typeof parsed.qwenModel === "string" ? parsed.qwenModel.trim() : "";
    const openrouterApiKey =
      typeof parsed.openrouterApiKey === "string" ? parsed.openrouterApiKey.trim() : "";
    const openrouterBuzzinModel =
      typeof parsed.openrouterBuzzinModel === "string" ? parsed.openrouterBuzzinModel.trim() : "";
    const openrouterGenerateModel =
      typeof parsed.openrouterGenerateModel === "string" ? parsed.openrouterGenerateModel.trim() : "";
    const openrouterVisionModel =
      typeof parsed.openrouterVisionModel === "string" ? parsed.openrouterVisionModel.trim() : "";
    const openrouterTtsModel =
      typeof parsed.openrouterTtsModel === "string" ? parsed.openrouterTtsModel.trim() : "";
    const videoGeneratorApiUrl =
      typeof parsed.videoGeneratorApiUrl === "string" ? parsed.videoGeneratorApiUrl.trim() : "";
    return {
      publicBaseUrl,
      inworldApiKey,
      inworldLlmModel,
      inworldSttModel,
      inworldSttLanguage,
      qwenApiKey,
      qwenModel,
      openrouterApiKey,
      openrouterBuzzinModel,
      openrouterGenerateModel,
      openrouterVisionModel,
      openrouterTtsModel,
      videoGeneratorApiUrl,
    };
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

  if (typeof next.inworldSttModel === "string") {
    next.inworldSttModel = next.inworldSttModel.trim();
  }

  if (typeof next.inworldSttLanguage === "string") {
    next.inworldSttLanguage = next.inworldSttLanguage.trim();
  }

  if (typeof next.qwenApiKey === "string") {
    next.qwenApiKey = next.qwenApiKey.trim();
  }

  if (typeof next.qwenModel === "string") {
    next.qwenModel = next.qwenModel.trim();
  }

  if (typeof next.openrouterApiKey === "string") {
    next.openrouterApiKey = next.openrouterApiKey.trim();
  }

  if (typeof next.openrouterBuzzinModel === "string") {
    next.openrouterBuzzinModel = next.openrouterBuzzinModel.trim();
  }

  if (typeof next.openrouterGenerateModel === "string") {
    next.openrouterGenerateModel = next.openrouterGenerateModel.trim();
  }

  if (typeof next.openrouterVisionModel === "string") {
    next.openrouterVisionModel = next.openrouterVisionModel.trim();
  }

  if (typeof next.openrouterTtsModel === "string") {
    next.openrouterTtsModel = next.openrouterTtsModel.trim();
  }

  if (typeof next.videoGeneratorApiUrl === "string") {
    next.videoGeneratorApiUrl = next.videoGeneratorApiUrl.trim().replace(/\/$/, "");
  }

  fs.writeFileSync(paths.appSettingsFile, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { readSettings, writeSettings };
