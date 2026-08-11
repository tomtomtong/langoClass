const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const archiver = require("archiver");
const paths = require("./paths");

const EXPORT_VERSION = 1;
const MAX_REMOTE_BYTES = 250 * 1024 * 1024;

function slugify(name) {
  return (
    String(name || "course")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "course"
  );
}

function normalizeUploadPath(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  if (value.startsWith("/uploads/")) return value;
  try {
    const parsed = new URL(value, "http://localhost");
    if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
  } catch {
    /* ignore */
  }
  return null;
}

function extFromUrl(url, fallback = "") {
  const uploadPath = normalizeUploadPath(url);
  if (uploadPath) {
    const ext = path.extname(uploadPath);
    if (ext) return ext;
  }
  try {
    const parsed = new URL(url, "http://localhost");
    const ext = path.extname(parsed.pathname);
    if (ext) return ext;
  } catch {
    /* ignore */
  }
  const match = String(url).match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  return match ? `.${match[1].toLowerCase()}` : fallback;
}

function hashUrl(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex").slice(0, 16);
}

function collectCourseUrls(course) {
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

function courseExportPayload(detail) {
  return {
    ...detail.course,
    sections: detail.sections || [],
  };
}

function zipAssetPath(uploadPath) {
  return `assets/${uploadPath.slice("/uploads/".length)}`;
}

function buildUrlMap(urls) {
  const urlToAssetPath = new Map();
  const assets = [];

  for (const url of urls) {
    const uploadPath = normalizeUploadPath(url);
    if (uploadPath) {
      const assetPath = zipAssetPath(uploadPath);
      urlToAssetPath.set(url, assetPath);
      if (!assets.some((entry) => entry.assetPath === assetPath)) {
        assets.push({
          url,
          assetPath,
          source: "local",
          uploadPath,
        });
      }
      continue;
    }

    if (/^https?:\/\//i.test(url) && !urlToAssetPath.has(url)) {
      const assetPath = `assets/videos/${hashUrl(url)}${extFromUrl(url, ".mp4")}`;
      urlToAssetPath.set(url, assetPath);
      assets.push({
        url,
        assetPath,
        source: "remote",
      });
    }
  }

  return { urlToAssetPath, assets };
}

function rewriteValue(url, urlToAssetPath) {
  if (url == null || url === "") return url;
  const trimmed = String(url).trim();
  const direct = urlToAssetPath.get(trimmed);
  if (direct) return direct;

  const uploadPath = normalizeUploadPath(trimmed);
  if (uploadPath) {
    const mapped = urlToAssetPath.get(uploadPath) || urlToAssetPath.get(trimmed);
    if (mapped) return mapped;
  }
  return url;
}

function rewriteCourse(course, urlToAssetPath) {
  const rewritten = JSON.parse(JSON.stringify(course));
  rewritten.banner = rewriteValue(rewritten.banner, urlToAssetPath);
  for (const section of rewritten.sections || []) {
    section.banner = rewriteValue(section.banner, urlToAssetPath);
    for (const exercise of section.exercises || []) {
      for (const item of exercise.items || []) {
        if (item.image != null) item.image = rewriteValue(item.image, urlToAssetPath);
        if (item.videoUrl != null) item.videoUrl = rewriteValue(item.videoUrl, urlToAssetPath);
        if (item.captionUrl != null) item.captionUrl = rewriteValue(item.captionUrl, urlToAssetPath);
        for (const track of item.captionTracks || []) {
          if (track.url != null) track.url = rewriteValue(track.url, urlToAssetPath);
        }
      }
    }
  }
  return rewritten;
}

async function fetchRemoteAsset(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_REMOTE_BYTES) {
    throw new Error(`File too large (max ${MAX_REMOTE_BYTES / 1024 / 1024}MB)`);
  }
  return buffer;
}

async function appendAsset(archive, asset, zipPrefix) {
  const zipName = `${zipPrefix}${asset.assetPath}`;
  const record = {
    url: asset.url,
    assetPath: asset.assetPath,
    source: asset.source,
    included: false,
  };

  try {
    if (asset.source === "local") {
      const filePath = paths.uploadFilePath(asset.uploadPath);
      if (!filePath || !fs.existsSync(filePath)) {
        record.error = "File not found";
        return record;
      }
      archive.file(filePath, { name: zipName });
      record.included = true;
      return record;
    }

    const buffer = await fetchRemoteAsset(asset.url);
    archive.append(buffer, { name: zipName });
    record.included = true;
    return record;
  } catch (err) {
    record.error = err.message || "Could not include asset";
    return record;
  }
}

async function appendCourseToArchive(archive, detail, zipPrefix) {
  const course = courseExportPayload(detail);
  const { urlToAssetPath, assets } = buildUrlMap(collectCourseUrls(course));
  const assetRecords = [];

  for (const asset of assets) {
    assetRecords.push(await appendAsset(archive, asset, zipPrefix));
  }

  const rewritten = rewriteCourse(course, urlToAssetPath);
  archive.append(JSON.stringify(rewritten, null, 2), {
    name: `${zipPrefix}course.json`,
  });

  return {
    id: course.id,
    name: course.name,
    assetCount: assetRecords.filter((entry) => entry.included).length,
    assets: assetRecords,
    course: rewritten,
  };
}

async function exportCoursesZip(courseDetails, { teacherId } = {}) {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const exportedAt = new Date().toISOString();
  const isMulti = courseDetails.length > 1;
  const manifest = {
    version: EXPORT_VERSION,
    exportedAt,
    teacherId: teacherId ?? null,
    courseCount: courseDetails.length,
    courses: [],
  };

  for (const detail of courseDetails) {
    const course = detail.course;
    const folderName = `course-${course.id}-${slugify(course.name)}`;
    const zipPrefix = isMulti ? `courses/${folderName}/` : "";
    const courseManifest = await appendCourseToArchive(archive, detail, zipPrefix);
    manifest.courses.push({
      id: courseManifest.id,
      name: courseManifest.name,
      folder: isMulti ? folderName : ".",
      assetCount: courseManifest.assetCount,
      assets: courseManifest.assets,
    });
  }

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  archive.finalize();
  return archive;
}

function exportFilename(courseDetails) {
  if (courseDetails.length === 1) {
    const course = courseDetails[0].course;
    return `course-${course.id}-${slugify(course.name)}.zip`;
  }
  return `langoclass-courses-${Date.now()}.zip`;
}

module.exports = {
  exportCoursesZip,
  exportFilename,
  slugify,
};
