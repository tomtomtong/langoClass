const fs = require("fs");
const paths = require("./paths");

const DEFAULT_SETTINGS = { publicBaseUrl: "" };

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
    return { publicBaseUrl };
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

  fs.writeFileSync(paths.appSettingsFile, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { readSettings, writeSettings };
