// Course files in R2. A file the classroom server wrote before R2 existed is
// read from the server once, the same way serveUpload falls back.
import { contentTypeForKey, uploadKey } from "./uploads.js";

// R2 multipart parts must share one size, except the last.
export const PART_BYTES = 10 * 1024 * 1024;

// Folders whose files belong to one course and may be deleted with it.
const OWNED_FOLDERS = new Set(["courses", "sections", "questions", "captions", "videos", "material"]);

export function uploadUrl(folder, filename) {
  return `/uploads/${folder}/${filename}`;
}

export function randomPart(length = 8) {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

export function extensionOf(name) {
  const match = String(name || "").toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match ? match[0] : "";
}

// The file behind an /uploads/ URL: R2 first, then the classroom server.
export async function openUpload(env, url, fetchImpl = fetch) {
  const key = uploadKey(url);
  if (!key) return null;
  const object = await env.UPLOADS?.get(key);
  if (object) {
    return {
      body: object.body,
      size: object.size,
      contentType: object.httpMetadata?.contentType || contentTypeForKey(key),
    };
  }
  const origin = String(env.ORIGIN || "").replace(/\/$/, "");
  if (!origin) return null;
  let remote;
  try {
    remote = await fetchImpl(`${origin}/${key}`, { headers: { "user-agent": "LangoClass" } });
  } catch (error) {
    // An unreachable classroom server counts as a missing file, so one lost
    // file cannot fail a whole publish, copy, or export.
    console.error(
      JSON.stringify({ message: "upload_origin_failed", key, error: error instanceof Error ? error.message : String(error) })
    );
    return null;
  }
  if (!remote.ok || !remote.body) {
    await remote.body?.cancel?.();
    return null;
  }
  const length = Number(remote.headers.get("content-length"));
  return {
    body: remote.body,
    size: Number.isFinite(length) && length >= 0 ? length : null,
    contentType: remote.headers.get("content-type")?.split(";")[0] || contentTypeForKey(key),
  };
}

// Copies an /uploads/ file to a new name in folder. A file that cannot be
// found keeps its old URL, as lib/community-store.js does.
export async function copyUpload(env, url, folder, fetchImpl = fetch) {
  const trimmed = String(url || "").trim();
  if (!uploadKey(trimmed)) return trimmed;
  const source = await openUpload(env, trimmed, fetchImpl);
  if (!source) return trimmed;
  const ext = extensionOf(trimmed);
  const target = uploadUrl(folder, `${Date.now()}-${randomPart()}${ext}`);
  await storeUpload(env, target, source.body, { contentType: source.contentType, size: source.size });
  return target;
}

export async function deleteUpload(env, url) {
  const key = uploadKey(url);
  if (!key || !env.UPLOADS) return;
  if (!OWNED_FOLDERS.has(key.split("/")[1])) return;
  try {
    await env.UPLOADS.delete(key);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "upload_delete_failed",
        key,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

// Deletes every R2 object under prefix, for example a community listing's
// asset folder.
export async function deletePrefix(env, prefix) {
  if (!env.UPLOADS) return;
  let cursor;
  do {
    const page = await env.UPLOADS.list({ prefix, cursor });
    const keys = (page.objects || []).map((object) => object.key);
    if (keys.length) await env.UPLOADS.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// Writes a stream to R2. With a known size it is a single put; otherwise the
// stream goes up in PART_BYTES parts so a large video never sits in memory.
export async function storeUpload(env, url, body, { contentType, size } = {}) {
  const key = uploadKey(url);
  if (!key) throw new Error("Invalid upload path.");
  if (!env.UPLOADS) throw new Error("File storage is not configured.");
  const httpMetadata = { contentType: contentType || contentTypeForKey(key) };
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body) || typeof body === "string") {
    await env.UPLOADS.put(key, body, { httpMetadata });
    return key;
  }
  await storeObject(env.UPLOADS, key, body, { httpMetadata, size });
  return key;
}

// Writes a stream to any R2 key, including import scratch space outside
// uploads/.
export async function storeObject(bucket, key, body, { httpMetadata, size } = {}) {
  if (Number.isFinite(size) && size >= 0 && typeof FixedLengthStream === "function") {
    const fixed = new FixedLengthStream(size);
    const piping = body.pipeTo(fixed.writable);
    await Promise.all([bucket.put(key, fixed.readable, { httpMetadata }), piping]);
    return;
  }
  await streamToR2(bucket, key, body, httpMetadata);
}

async function streamToR2(bucket, key, body, httpMetadata) {
  const reader = body.getReader();
  let upload = null;
  const parts = [];
  let buffer = new Uint8Array(PART_BYTES);
  let filled = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let offset = 0;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      while (offset < chunk.length) {
        const take = Math.min(PART_BYTES - filled, chunk.length - offset);
        buffer.set(chunk.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === PART_BYTES) {
          upload ||= await bucket.createMultipartUpload(key, { httpMetadata });
          parts.push(await upload.uploadPart(parts.length + 1, buffer));
          buffer = new Uint8Array(PART_BYTES);
          filled = 0;
        }
      }
    }
    if (!upload) {
      await bucket.put(key, buffer.slice(0, filled), { httpMetadata });
      return;
    }
    if (filled) parts.push(await upload.uploadPart(parts.length + 1, buffer.slice(0, filled)));
    await upload.complete(parts);
  } catch (error) {
    await upload?.abort().catch(() => {});
    await reader.cancel().catch(() => {});
    throw error;
  }
}

// Every upload URL a course points at, in the fields lib/community-store.js
// and lib/course-import.js rewrite.
export function courseUrls(course) {
  const urls = new Set();
  const add = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed) urls.add(trimmed);
  };
  add(course?.banner);
  for (const section of course?.sections || []) {
    add(section.banner);
    add(section.introVideoUrl);
    for (const exercise of section.exercises || []) {
      for (const item of exercise.items || []) {
        add(item.image);
        add(item.videoUrl);
        add(item.captionUrl);
        for (const track of item.captionTracks || []) add(track.url);
      }
    }
  }
  return [...urls];
}

// A copy of course with every URL passed through swap.
export function rewriteCourseUrls(course, swap) {
  const rewritten = structuredClone(course);
  rewritten.banner = swap(rewritten.banner);
  for (const section of rewritten.sections || []) {
    section.banner = swap(section.banner);
    section.introVideoUrl = swap(section.introVideoUrl);
    for (const exercise of section.exercises || []) {
      for (const item of exercise.items || []) {
        if (item.image != null) item.image = swap(item.image);
        if (item.videoUrl != null) item.videoUrl = swap(item.videoUrl);
        if (item.captionUrl != null) item.captionUrl = swap(item.captionUrl);
        for (const track of item.captionTracks || []) {
          if (track.url != null) track.url = swap(track.url);
        }
      }
    }
  }
  return rewritten;
}

// Copies each /uploads/ file a course uses; folderFor picks the new folder.
export async function copyCourseFiles(env, course, folderFor, fetchImpl = fetch) {
  const map = new Map();
  for (const url of courseUrls(course)) {
    if (!uploadKey(url)) continue;
    map.set(url, await copyUpload(env, url, folderFor(url), fetchImpl));
  }
  return rewriteCourseUrls(course, (url) => map.get(String(url || "").trim()) || url);
}
