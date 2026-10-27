// Course backup import and export, following lib/course-import.js,
// lib/course-import-chunked.js, and lib/course-export.js. Uploaded backups
// wait in R2 under import-tmp/ until they are imported.
import {
  courseUrls,
  deleteUpload,
  deletePrefix,
  extensionOf,
  openUpload,
  randomPart,
  rewriteCourseUrls,
  storeObject,
  storeUpload,
  uploadUrl,
} from "./course-files.js";
import { streamFormFile } from "./course-media.js";
import { ZipWriter, openZipEntry, readZipEntries, readZipText } from "./course-zip.js";
import {
  countExercises,
  courseDetail,
  json,
  newCourse,
  numberSections,
  readDoc,
  readJson,
  requireTeacher,
  sameId,
  writeDocs,
} from "./d1-store.js";

export const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const CHUNK_BYTES = 512 * 1024;
const IMPORT_VERSION = 1;
const MAX_REMOTE_BYTES = 250 * 1024 * 1024;
const ASSET_FOLDERS = new Set(["courses", "sections", "questions", "captions", "videos"]);

export async function handleCourseTransferApi(request, env, url, { fetchImpl = fetch } = {}) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "GET") {
    const one = pathname.match(/^\/api\/cms\/courses\/(-?\d+)\/export$/);
    if (pathname !== "/api/cms/courses/export-all" && !one) return null;
    return withTeacher(request, env, (auth) => exportCourses(env, auth, one ? Number(one[1]) : null, fetchImpl));
  }
  if (method !== "POST") return null;
  const route = pathname.match(/^\/api\/cms\/courses\/import-(one|all)(?:\/(init|chunk|complete))?$/);
  if (!route) return null;
  const options = route[1] === "one" ? { replace: false, maxCourses: 1 } : { replace: true, maxCourses: null };
  return withTeacher(request, env, async (auth) => {
    if (route[2] === "init") return initImport(request, env, auth);
    if (route[2] === "chunk") return storeChunk(request, env, auth);
    if (route[2] === "complete") return completeImport(request, env, auth, options);
    return importUpload(request, env, auth, options);
  });
}

async function withTeacher(request, env, handler) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  if (!env.UPLOADS) return json({ message: "File storage is not configured." }, 500);
  try {
    return await handler(auth);
  } catch (error) {
    if (error instanceof TransferError) return json({ message: error.message }, error.status);
    throw error;
  }
}

class TransferError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// --- import ---------------------------------------------------------------

async function initImport(request, env, auth) {
  const body = await readJson(request);
  const totalBytes = Number(body.totalBytes);
  const totalChunks = Number(body.totalChunks);
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) throw new TransferError("Invalid totalBytes.");
  if (!Number.isInteger(totalChunks) || totalChunks <= 0) throw new TransferError("Invalid totalChunks.");
  if (totalBytes > MAX_ZIP_BYTES) throw new TransferError(tooLarge());
  const uploadId = randomPart(32);
  await env.UPLOADS.put(
    sessionKey(uploadId),
    JSON.stringify({
      teacherId: auth.teacherId,
      totalBytes,
      totalChunks,
      fileName: String(body.fileName || "import.zip").slice(0, 200),
      createdAt: new Date().toISOString(),
    })
  );
  return json({ ok: true, uploadId, chunkSize: CHUNK_BYTES });
}

async function storeChunk(request, env, auth) {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new TransferError("Chunk upload failed.");
  }
  const uploadId = String(form.get("uploadId") || "");
  const chunkIndex = Number(form.get("chunkIndex"));
  const chunk = form.get("chunk");
  const session = await readSession(env, uploadId, auth.teacherId);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw new TransferError("Invalid chunk index.");
  }
  if (!chunk || typeof chunk === "string") throw new TransferError("No chunk data provided.");
  if (!chunk.size) throw new TransferError("Empty chunk.");
  if (chunk.size > CHUNK_BYTES + 1024 * 1024) throw new TransferError("Chunk is too large.");
  await env.UPLOADS.put(chunkKey(uploadId, chunkIndex), await chunk.arrayBuffer());
  // Chunks arrive in order from the CMS, so this is the count received.
  return json({ ok: true, received: chunkIndex + 1, totalChunks: session.totalChunks });
}

async function completeImport(request, env, auth, options) {
  const uploadId = String((await readJson(request)).uploadId || "");
  const session = await readSession(env, uploadId, auth.teacherId);
  try {
    const sizes = await chunkSizes(env, uploadId);
    if (sizes.length !== session.totalChunks || sizes.some((size) => size == null)) {
      throw new TransferError(`Missing chunks (${sizes.filter((size) => size != null).length}/${session.totalChunks}).`);
    }
    if (sizes.reduce((sum, size) => sum + size, 0) !== session.totalBytes) {
      throw new TransferError("Uploaded size does not match expected size.");
    }
    return await importBackup(env, auth.teacherId, chunkSource(env.UPLOADS, uploadId, sizes), options);
  } finally {
    await deletePrefix(env, importPrefix(uploadId));
  }
}

// One request with the whole ZIP as the "file" field.
async function importUpload(request, env, auth, options) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_ZIP_BYTES + 1024 * 1024) throw new TransferError(tooLarge());
  const messages = { missing: "No ZIP file provided.", tooLarge: tooLarge() };
  let file;
  try {
    file = await streamFormFile(request, "file", MAX_ZIP_BYTES, messages);
  } catch (error) {
    throw new TransferError(error instanceof Error ? error.message : "Upload failed.");
  }
  const uploadId = randomPart(32);
  try {
    try {
      await storeObject(env.UPLOADS, chunkKey(uploadId, 0), file.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === messages.missing || message === messages.tooLarge) throw new TransferError(message);
      throw error;
    }
    const sizes = await chunkSizes(env, uploadId);
    return await importBackup(env, auth.teacherId, chunkSource(env.UPLOADS, uploadId, sizes), options);
  } finally {
    await deletePrefix(env, importPrefix(uploadId));
  }
}

async function importBackup(env, teacherId, source, { replace, maxCourses }) {
  let entries;
  try {
    entries = await readZipEntries(source);
  } catch {
    throw new TransferError("Invalid ZIP file.");
  }
  if (!entries.length) throw new TransferError("ZIP file is empty.");
  const files = new Map(entries.map((entry) => [entry.name, entry]));

  const manifest = files.get("manifest.json");
  if (manifest) {
    const parsed = parseJson(await readZipText(source, manifest), "manifest.json");
    if (parsed?.version != null && Number(parsed.version) > IMPORT_VERSION) {
      throw new TransferError("This export was created by a newer version and cannot be imported.");
    }
  }
  let packages = entries
    .filter((entry) => entry.name.endsWith("course.json"))
    .map((entry) => ({ entry, prefix: entry.name.slice(0, -"course.json".length) }))
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  if (!packages.length) throw new TransferError("No course.json found in ZIP.");
  if (maxCourses) packages = packages.slice(0, maxCourses);

  // Read every course.json before anything is replaced, so a broken backup
  // leaves the teacher's courses alone.
  const parsed = [];
  for (const pkg of packages) {
    const course = parseJson(await readZipText(source, pkg.entry), pkg.entry.name);
    if (!course || typeof course !== "object") throw new TransferError(`Could not read ${pkg.entry.name}.`);
    parsed.push({ ...pkg, course });
  }

  const written = [];
  const prepared = [];
  try {
    for (const pkg of parsed) {
      const restored = await restoreAssets(env, source, files, pkg.prefix, pkg.course, teacherId, written);
      prepared.push(prepareForImport(restored));
    }
  } catch (error) {
    for (const url of written) await deleteUpload(env, url);
    throw error;
  }

  const courses = await readDoc(env, "teacher-courses", { courses: [] });
  if (!Array.isArray(courses.courses)) courses.courses = [];
  const writes = [];
  let replaced = 0;
  let removed = [];
  if (replace) {
    removed = courses.courses.filter((course) => sameId(course.teacherId, teacherId));
    courses.courses = courses.courses.filter((course) => !sameId(course.teacherId, teacherId));
    replaced = removed.length;
    if (removed.length) writes.push(...(await forgetCourses(env, teacherId, removed.map((course) => course.id))));
  }

  const now = new Date().toISOString();
  const imported = [];
  for (const payload of prepared) {
    const course = newCourse(courses, teacherId, { ...payload, classIds: [] }, now);
    course.sections = numberSections(payload.sections || []);
    courses.courses.push(course);
    imported.push({ id: course.id, name: course.name, exerciseCount: countExercises(course) });
  }
  await writeDocs(env, [["teacher-courses", courses], ...writes]);
  if (removed.length) {
    await deleteCourseScores(env, teacherId, removed.map((course) => course.id));
    for (const course of removed) for (const url of courseUrls(course)) await deleteUpload(env, url);
  }
  return json({ ok: true, imported: imported.length, replaced, courses: imported });
}

async function restoreAssets(env, source, files, prefix, course, teacherId, written) {
  const stored = new Map();
  const restore = async (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed)) return trimmed;
    let assetPath;
    let missing;
    if (trimmed.startsWith("assets/")) {
      assetPath = trimmed;
      missing = "";
    } else if (trimmed.startsWith("/uploads/")) {
      assetPath = `assets/${trimmed.slice("/uploads/".length)}`;
      missing = trimmed;
    } else {
      return trimmed;
    }
    if (stored.has(assetPath)) return stored.get(assetPath);
    const entry = findAsset(files, prefix, assetPath);
    if (!entry) return missing;
    const [folder, ...rest] = assetPath.slice("assets/".length).split("/");
    if (!ASSET_FOLDERS.has(folder) || !rest.length) return "";
    const url = uploadUrl(folder, `import-${teacherId}-${Date.now()}-${randomPart(6)}${extensionOf(assetPath)}`);
    await storeUpload(env, url, await openZipEntry(source, entry), { size: entry.size });
    written.push(url);
    stored.set(assetPath, url);
    return url;
  };

  // Resolve each distinct URL once, then rewrite synchronously.
  const urls = courseUrls(course);
  const resolved = new Map();
  for (const url of urls) resolved.set(url, await restore(url));
  const rewritten = rewriteCourseUrls(course, (value) => {
    const key = String(value ?? "").trim();
    return resolved.has(key) ? resolved.get(key) : value;
  });
  for (const section of rewritten.sections || []) {
    for (const exercise of section.exercises || []) {
      for (const item of exercise.items || []) {
        if (item.image === "") item.image = null;
      }
    }
  }
  return rewritten;
}

function findAsset(files, prefix, assetPath) {
  const candidates = [];
  if (prefix) candidates.push(`${prefix}${assetPath}`);
  candidates.push(assetPath);
  for (const candidate of candidates) {
    const entry = files.get(candidate);
    if (entry) return entry;
  }
  return null;
}

function prepareForImport(course) {
  const copy = structuredClone(course);
  delete copy.id;
  delete copy.teacherId;
  delete copy.createdAt;
  delete copy.updatedAt;
  for (const section of copy.sections || []) {
    delete section.id;
    for (const exercise of section.exercises || []) delete exercise.id;
  }
  return copy;
}

// Progress and old-document scores for courses an import-all replaces, as
// lib/course-import.js clears them.
async function forgetCourses(env, teacherId, courseIds) {
  const ids = new Set(courseIds.map(Number));
  const progress = await readDoc(env, "host-progress", { records: [] });
  progress.records = (progress.records || []).filter(
    (record) => !(sameId(record.teacherId, teacherId) && ids.has(Number(record.courseId)))
  );
  const scores = await readDoc(env, "student-scores", { students: {}, records: [] });
  scores.records = (scores.records || []).filter(
    (record) => !(sameId(record.teacherId, teacherId) && ids.has(Number(record.courseId)))
  );
  return [["host-progress", progress], ["student-scores", scores]];
}

async function deleteCourseScores(env, teacherId, courseIds) {
  const ids = courseIds.map(Number).filter(Number.isFinite);
  if (!ids.length) return;
  await env.DB.prepare(
    `DELETE FROM score_records WHERE teacher_id = ? AND CAST(json_extract(body, '$.courseId') AS INTEGER) IN (${ids.map(() => "?").join(", ")})`
  )
    .bind(String(teacherId), ...ids)
    .run();
}

async function readSession(env, uploadId, teacherId) {
  if (!/^[a-f0-9]{32}$/.test(uploadId)) throw new TransferError("Upload session not found or expired.");
  const object = await env.UPLOADS.get(sessionKey(uploadId));
  const session = object ? parseJson(await object.text(), "session") : null;
  if (!session || !sameId(session.teacherId, teacherId)) throw new TransferError("Upload session not found or expired.");
  return session;
}

async function chunkSizes(env, uploadId) {
  const sizes = [];
  let cursor;
  do {
    const page = await env.UPLOADS.list({ prefix: `${importPrefix(uploadId)}chunk-`, cursor });
    for (const object of page.objects || []) {
      const index = Number(object.key.slice(object.key.lastIndexOf("-") + 1));
      if (Number.isInteger(index)) sizes[index] = object.size;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return Array.from({ length: sizes.length }, (_, index) => sizes[index] ?? null);
}

// The uploaded chunks read as one file.
function chunkSource(bucket, uploadId, sizes) {
  const starts = [];
  let total = 0;
  for (const size of sizes) {
    starts.push(total);
    total += size;
  }
  const stream = (start, end) => {
    let position = start;
    return new ReadableStream({
      async pull(controller) {
        if (position >= end) return controller.close();
        let index = starts.length - 1;
        while (starts[index] > position) index -= 1;
        const offset = position - starts[index];
        const length = Math.min(sizes[index] - offset, end - position);
        const object = await bucket.get(chunkKey(uploadId, index), { range: { offset, length } });
        if (!object) return controller.error(new Error("Uploaded backup is incomplete."));
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (!bytes.length) return controller.error(new Error("Uploaded backup is incomplete."));
        position += bytes.length;
        controller.enqueue(bytes);
      },
    });
  };
  return {
    size: total,
    stream,
    bytes: async (start, end) => new Uint8Array(await new Response(stream(start, end)).arrayBuffer()),
  };
}

function importPrefix(uploadId) {
  return `import-tmp/${uploadId}/`;
}

function sessionKey(uploadId) {
  return `${importPrefix(uploadId)}session.json`;
}

function chunkKey(uploadId, index) {
  return `${importPrefix(uploadId)}chunk-${index}`;
}

function parseJson(text, name) {
  try {
    return JSON.parse(text);
  } catch {
    throw new TransferError(`Invalid JSON in ${name}.`);
  }
}

function tooLarge() {
  return `ZIP file is too large (max ${MAX_ZIP_BYTES / 1024 / 1024}MB).`;
}

// --- export ---------------------------------------------------------------

async function exportCourses(env, auth, courseId, fetchImpl) {
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const own = (store.courses || []).filter((course) => sameId(course.teacherId, auth.teacherId));
  const chosen = courseId == null ? own : own.filter((course) => course.id === courseId);
  if (!chosen.length) {
    return json({ message: courseId == null ? "No courses to export." : "Course not found." }, 404);
  }
  const details = chosen.map((course) => courseDetail(course));
  const filename =
    details.length === 1
      ? `course-${details[0].course.id}-${slugify(details[0].course.name)}.zip`
      : `langoclass-courses-${Date.now()}.zip`;

  const { readable, writable } = new TransformStream();
  writeExport(env, writable.getWriter(), details, auth.teacherId, fetchImpl).catch((error) => {
    console.error(
      JSON.stringify({ message: "course_export_failed", error: error instanceof Error ? error.message : String(error) })
    );
  });
  return new Response(readable, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

async function writeExport(env, writer, details, teacherId, fetchImpl) {
  const zip = new ZipWriter(writer);
  try {
    const multi = details.length > 1;
    const manifest = {
      version: IMPORT_VERSION,
      exportedAt: new Date().toISOString(),
      teacherId: teacherId ?? null,
      courseCount: details.length,
      courses: [],
    };
    for (const detail of details) {
      const course = { ...detail.course, sections: detail.sections || [] };
      const folder = `course-${course.id}-${slugify(course.name)}`;
      const prefix = multi ? `courses/${folder}/` : "";
      const { assetFor, assets } = await planAssets(courseUrls(course));
      const records = [];
      for (const asset of assets) records.push(await addAsset(env, zip, asset, prefix, fetchImpl));
      const rewritten = rewriteCourseUrls(course, (value) => assetFor(value) ?? value);
      await zip.add(`${prefix}course.json`, JSON.stringify(rewritten, null, 2));
      manifest.courses.push({
        id: course.id,
        name: course.name,
        folder: multi ? folder : ".",
        assetCount: records.filter((record) => record.included).length,
        assets: records,
      });
    }
    await zip.add("manifest.json", JSON.stringify(manifest, null, 2));
    await zip.finish();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }
}

async function planAssets(urls) {
  const byUrl = new Map();
  const assets = [];
  for (const url of urls) {
    const uploadPath = normalizeUploadPath(url);
    let assetPath;
    let source;
    if (uploadPath) {
      assetPath = `assets/${uploadPath.slice("/uploads/".length)}`;
      source = "local";
    } else if (/^https?:\/\//i.test(url)) {
      assetPath = `assets/videos/${await hashUrl(url)}${extensionOf(new URL(url).pathname) || ".mp4"}`;
      source = "remote";
    } else {
      continue;
    }
    byUrl.set(url, assetPath);
    if (!assets.some((asset) => asset.assetPath === assetPath)) assets.push({ url, assetPath, source, uploadPath });
  }
  const assetFor = (value) => {
    const trimmed = String(value ?? "").trim();
    return byUrl.get(trimmed) ?? byUrl.get(normalizeUploadPath(trimmed) || "") ?? null;
  };
  return { assetFor, assets };
}

async function addAsset(env, zip, asset, prefix, fetchImpl) {
  const record = { url: asset.url, assetPath: asset.assetPath, source: asset.source, included: false };
  let body;
  try {
    if (asset.source === "local") {
      body = (await openUpload(env, asset.uploadPath, fetchImpl))?.body;
      if (!body) {
        record.error = "File not found";
        return record;
      }
    } else {
      const response = await fetchImpl(asset.url);
      if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);
      if (Number(response.headers.get("content-length")) > MAX_REMOTE_BYTES) {
        await response.body.cancel();
        throw new Error(`File too large (max ${MAX_REMOTE_BYTES / 1024 / 1024}MB)`);
      }
      body = response.body;
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : "Could not include asset";
    return record;
  }
  // Once the entry has started, a failed read cannot be skipped: the ZIP
  // would be broken, so the export stops instead.
  await zip.add(`${prefix}${asset.assetPath}`, body);
  record.included = true;
  return record;
}

function normalizeUploadPath(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  if (value.startsWith("/uploads/")) return value;
  try {
    const parsed = new URL(value, "http://localhost");
    if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
  } catch {
    /* not a URL */
  }
  return null;
}

async function hashUrl(url) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(url)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function slugify(name) {
  return (
    String(name || "course")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "course"
  );
}
