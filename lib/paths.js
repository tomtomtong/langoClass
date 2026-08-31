const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const persistentRoot = process.env.PERSISTENT_DATA_PATH
  ? path.resolve(process.env.PERSISTENT_DATA_PATH)
  : projectRoot;

const dataDir = path.join(persistentRoot, "data");
const uploadsRoot = process.env.PERSISTENT_DATA_PATH
  ? path.join(persistentRoot, "uploads")
  : path.join(projectRoot, "public", "uploads");

const uploadsCoursesDir = path.join(uploadsRoot, "courses");
const uploadsSectionsDir = path.join(uploadsRoot, "sections");
const uploadsQuestionsDir = path.join(uploadsRoot, "questions");
const uploadsCaptionsDir = path.join(uploadsRoot, "captions");
const uploadsVideosDir = path.join(uploadsRoot, "videos");
const uploadsMaterialDir = path.join(uploadsRoot, "material");

function ensurePersistentDirs() {
  for (const dir of [
    dataDir,
    uploadsCoursesDir,
    uploadsSectionsDir,
    uploadsQuestionsDir,
    uploadsCaptionsDir,
    uploadsVideosDir,
    uploadsMaterialDir,
  ]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function uploadFilePath(uploadUrl) {
  const url = String(uploadUrl || "");
  if (!url.startsWith("/uploads/")) return null;
  return path.join(uploadsRoot, url.slice("/uploads/".length));
}

module.exports = {
  dataDir,
  uploadsRoot,
  uploadsCoursesDir,
  uploadsSectionsDir,
  uploadsQuestionsDir,
  uploadsCaptionsDir,
  uploadsVideosDir,
  uploadsMaterialDir,
  ensurePersistentDirs,
  uploadFilePath,
  teacherCoursesFile: path.join(dataDir, "teacher-courses.json"),
  studentScoresFile: path.join(dataDir, "student-scores.json"),
  hostProgressFile: path.join(dataDir, "host-progress.json"),
  appSettingsFile: path.join(dataDir, "app-settings.json"),
};
