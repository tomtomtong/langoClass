const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const paths = require("./paths");
const cmsStore = require("./cms-store");
const scoreStore = require("./score-store");
const hostProgressStore = require("./host-progress-store");

const IMPORT_VERSION = 1;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;

const UPLOAD_CATEGORY_DIRS = {
  courses: () => paths.uploadsCoursesDir,
  sections: () => paths.uploadsSectionsDir,
  questions: () => paths.uploadsQuestionsDir,
  captions: () => paths.uploadsCaptionsDir,
  videos: () => paths.uploadsVideosDir,
};

function normalizeZipPath(entryName) {
  return String(entryName || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function buildZipFileMap(zip) {
  const files = new Map();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    files.set(normalizeZipPath(entry.entryName), entry.getData());
  }
  return files;
}

function findCoursePackages(files) {
  const packages = [];
  for (const entryName of files.keys()) {
    if (!entryName.endsWith("course.json")) continue;
    packages.push({
      courseJsonPath: entryName,
      prefix: entryName.slice(0, -"course.json".length),
    });
  }
  packages.sort((a, b) => a.courseJsonPath.localeCompare(b.courseJsonPath));
  return packages;
}

function readJsonFile(files, filePath) {
  const data = files.get(filePath);
  if (!data) return null;
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    throw new Error(`Invalid JSON in ${filePath}.`);
  }
}

function validateManifest(files) {
  const manifest = readJsonFile(files, "manifest.json");
  if (!manifest) return;
  if (manifest.version != null && Number(manifest.version) > IMPORT_VERSION) {
    throw new Error("This export was created by a newer version and cannot be imported.");
  }
}

function resolveZipAssetData(assetPath, prefix, files) {
  const normalized = String(assetPath || "").replace(/^\/+/, "");
  const candidates = new Set();
  if (prefix) candidates.add(`${prefix}${normalized}`);
  candidates.add(normalized);
  if (normalized.startsWith("assets/")) {
    const withoutAssets = normalized.slice("assets/".length);
    candidates.add(`${prefix}assets/${withoutAssets}`);
    candidates.add(`assets/${withoutAssets}`);
  }
  for (const candidate of candidates) {
    const data = files.get(candidate);
    if (data) return data;
  }
  return null;
}

function writeImportedAsset(assetPath, buffer, teacherId) {
  const relative = String(assetPath || "").replace(/^assets\//, "");
  const [category, ...rest] = relative.split("/");
  const destDirFactory = UPLOAD_CATEGORY_DIRS[category];
  if (!destDirFactory || !rest.length) return "";

  paths.ensurePersistentDirs();
  const destDir = destDirFactory();
  const ext = path.extname(relative) || "";
  const filename = `import-${teacherId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const destPath = path.join(destDir, filename);
  fs.writeFileSync(destPath, buffer);
  return `/uploads/${category}/${filename}`;
}

function restoreAssetUrl(url, prefix, files, teacherId) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  if (trimmed.startsWith("assets/")) {
    const data = resolveZipAssetData(trimmed, prefix, files);
    if (!data) return "";
    return writeImportedAsset(trimmed, data, teacherId);
  }

  if (trimmed.startsWith("/uploads/")) {
    const assetPath = `assets/${trimmed.slice("/uploads/".length)}`;
    const data = resolveZipAssetData(assetPath, prefix, files);
    if (!data) return trimmed;
    return writeImportedAsset(assetPath, data, teacherId);
  }

  return trimmed;
}

function collectCourseUploadUrls(course) {
  const urls = new Set();
  const add = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed) urls.add(trimmed);
  };

  add(course.banner);
  for (const section of course.sections || []) {
    add(section.banner);
    for (const exercise of section.exercises || []) {
      for (const item of exercise.items || []) {
        add(item.image);
        add(item.videoUrl);
        add(item.captionUrl);
        for (const track of item.captionTracks || []) {
          add(track.url);
        }
      }
    }
  }
  return urls;
}

function deleteUploadUrl(uploadUrl) {
  const url = String(uploadUrl || "");
  if (
    !url.startsWith("/uploads/courses/") &&
    !url.startsWith("/uploads/sections/") &&
    !url.startsWith("/uploads/questions/") &&
    !url.startsWith("/uploads/captions/") &&
    !url.startsWith("/uploads/videos/") &&
    !url.startsWith("/uploads/material/")
  ) {
    return;
  }
  const filePath = paths.uploadFilePath(url);
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore missing files */
  }
}

function deleteCourseMedia(course) {
  for (const url of collectCourseUploadUrls(course)) {
    deleteUploadUrl(url);
  }
}

function clearTeacherCoursesBeforeImport(teacherId) {
  const existing = cmsStore.removeAllCoursesForTeacher(teacherId);
  const courseIds = existing.map((course) => course.id);

  for (const course of existing) {
    deleteCourseMedia(course);
  }

  if (courseIds.length) {
    scoreStore.deleteRecordsForTeacherCourses(teacherId, courseIds);
    hostProgressStore.deleteProgressForTeacherCourses(teacherId, courseIds);
  }

  return { removedCourses: existing.length };
}

function rewriteCourseAssets(course, prefix, files, teacherId) {
  const rewritten = JSON.parse(JSON.stringify(course));
  rewritten.banner = restoreAssetUrl(rewritten.banner, prefix, files, teacherId);

  for (const section of rewritten.sections || []) {
    section.banner = restoreAssetUrl(section.banner, prefix, files, teacherId);
    for (const exercise of section.exercises || []) {
      for (const item of exercise.items || []) {
        if (item.image != null) item.image = restoreAssetUrl(item.image, prefix, files, teacherId) || null;
        if (item.videoUrl != null) item.videoUrl = restoreAssetUrl(item.videoUrl, prefix, files, teacherId);
        if (item.captionUrl != null) {
          item.captionUrl = restoreAssetUrl(item.captionUrl, prefix, files, teacherId);
        }
        for (const track of item.captionTracks || []) {
          if (track.url != null) track.url = restoreAssetUrl(track.url, prefix, files, teacherId);
        }
      }
    }
  }

  return rewritten;
}

function prepareCourseForImport(course) {
  const copy = JSON.parse(JSON.stringify(course));
  delete copy.id;
  delete copy.teacherId;
  delete copy.createdAt;
  delete copy.updatedAt;
  copy.classIds = [];

  for (const section of copy.sections || []) {
    delete section.id;
    for (const exercise of section.exercises || []) {
      delete exercise.id;
    }
  }

  return copy;
}

function importCoursePackage(courseJson, prefix, files, teacherId) {
  const restored = rewriteCourseAssets(courseJson, prefix, files, teacherId);
  const payload = prepareCourseForImport(restored);

  const created = cmsStore.createCourse(teacherId, {
    name: payload.name,
    description: payload.description,
    banner: payload.banner,
    langCode: payload.langCode,
    classIds: [],
  });

  const saved = cmsStore.saveSections(created.id, teacherId, payload.sections || []);
  if (!saved) {
    cmsStore.deleteCourse(created.id, teacherId);
    throw new Error(`Could not import "${payload.name || "course"}".`);
  }

  return {
    id: saved.id,
    name: saved.name,
    exerciseCount: cmsStore.flattenExercises(saved).length,
  };
}

function importCoursesFromZip(buffer, teacherId, { replace = true } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("No ZIP file provided.");
  }
  if (buffer.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP file is too large (max ${MAX_ZIP_BYTES / 1024 / 1024}MB).`);
  }

  let replaceSummary = null;
  if (replace) {
    replaceSummary = clearTeacherCoursesBeforeImport(teacherId);
  }

  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("Invalid ZIP file.");
  }

  const files = buildZipFileMap(zip);
  if (!files.size) {
    throw new Error("ZIP file is empty.");
  }

  validateManifest(files);
  const packages = findCoursePackages(files);
  if (!packages.length) {
    throw new Error("No course.json found in ZIP.");
  }

  const imported = [];
  for (const pkg of packages) {
    const courseJson = readJsonFile(files, pkg.courseJsonPath);
    if (!courseJson || typeof courseJson !== "object") {
      throw new Error(`Could not read ${pkg.courseJsonPath}.`);
    }
    imported.push(importCoursePackage(courseJson, pkg.prefix, files, teacherId));
  }

  return {
    courses: imported,
    replaced: replaceSummary?.removedCourses || 0,
  };
}

module.exports = {
  importCoursesFromZip,
  clearTeacherCoursesBeforeImport,
  MAX_ZIP_BYTES,
};
