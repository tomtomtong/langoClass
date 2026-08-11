const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const paths = require("./paths");
const cmsStore = require("./cms-store");

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

function importCoursesFromZip(buffer, teacherId) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("No ZIP file provided.");
  }
  if (buffer.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP file is too large (max ${MAX_ZIP_BYTES / 1024 / 1024}MB).`);
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

  return imported;
}

module.exports = {
  importCoursesFromZip,
  MAX_ZIP_BYTES,
};
