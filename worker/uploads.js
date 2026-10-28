// Uploaded files live in R2. Sharp, HEIC, PDF, and Word still run on the
// classroom server, which writes the file; this module copies that object in.

const FOLDERS = new Set([
  "courses",
  "sections",
  "questions",
  "captions",
  "videos",
  "material",
  "community",
  "lectures",
]);

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  vtt: "text/vtt; charset=utf-8",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
};

const MIRROR_LIMIT = 40;

export function uploadKey(pathname) {
  const pathOnly = String(pathname || "").split("?")[0].split("#")[0];
  if (!pathOnly.startsWith("/uploads/")) return "";
  const parts = pathOnly.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "uploads" || !FOLDERS.has(parts[1])) return "";
  if (parts.some((part) => part === "." || part === ".." || part.includes("\\"))) return "";
  if (!parts.slice(2).every((part) => /^[A-Za-z0-9._-]+$/.test(part))) return "";
  return parts.join("/");
}

export function collectUploadPaths(value, found = new Set()) {
  if (typeof value === "string") {
    const matches = value.match(/\/uploads\/[A-Za-z0-9._/-]+/g) || [];
    for (const match of matches) {
      const key = uploadKey(match);
      if (key) found.add(`/${key}`);
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUploadPaths(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUploadPaths(item, found);
  }
  return found;
}

export function contentTypeForKey(key) {
  const ext = String(key || "").split(".").pop()?.toLowerCase() || "";
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

export async function serveUpload(request, { bucket, origin, fetchImpl = fetch, waitUntil } = {}) {
  const key = uploadKey(new URL(request.url).pathname);
  if (!key) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (!bucket) return fetchOriginUpload(request, origin, key, fetchImpl);

  if (request.method === "HEAD") {
    const head = await bucket.head(key);
    if (!head) {
      waitUntil?.(copyUpload(bucket, origin, `/${key}`, fetchImpl));
      return uncached(await fetchOriginUpload(request, origin, key, fetchImpl));
    }
    return objectResponse(head, request, { head: true });
  }

  const object = await bucket.get(key, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (object) return objectResponse(object, request);

  const originResponse = await fetchOriginUpload(request, origin, key, fetchImpl);
  if (!originResponse.ok || !originResponse.body || request.headers.has("range")) {
    if (originResponse.ok && request.headers.has("range")) {
      waitUntil?.(copyUpload(bucket, origin, `/${key}`, fetchImpl));
    }
    return uncached(originResponse);
  }

  const contentType = mediaType(originResponse.headers.get("content-type")) || contentTypeForKey(key);
  const [clientBody, storeBody] = originResponse.body.tee();
  waitUntil?.(
    bucket.put(key, storeBody, { httpMetadata: { contentType } }).then(() => {
      console.log(JSON.stringify({ message: "upload_stored", key }));
    }).catch((error) => {
      console.error(
        JSON.stringify({
          message: "upload_store_failed",
          key,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    })
  );
  const headers = new Headers(originResponse.headers);
  headers.set("content-type", contentType);
  headers.set("cache-control", "no-store");
  return new Response(clientBody, { status: originResponse.status, headers });
}

function uncached(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function mirrorStoredUploads(response, { bucket, origin, fetchImpl = fetch, method } = {}) {
  if (!bucket || !response?.ok) return 0;
  const verb = String(method || "").toUpperCase();
  if (verb !== "POST" && verb !== "PUT" && verb !== "PATCH") return 0;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("json")) return 0;

  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return 0;
  }
  const paths = [...collectUploadPaths(payload)].slice(0, MIRROR_LIMIT);
  let stored = 0;
  for (const uploadPath of paths) {
    if (await copyUpload(bucket, origin, uploadPath, fetchImpl)) stored += 1;
  }
  return stored;
}

async function copyUpload(bucket, origin, uploadPath, fetchImpl) {
  const key = uploadKey(uploadPath);
  if (!key) return false;
  const remote = await fetchImpl(new URL(uploadPath, origin), {
    method: "GET",
    headers: { "user-agent": "LangoClass" },
  });
  if (!remote.ok || !remote.body) {
    console.log(JSON.stringify({ message: "upload_origin_miss", path: uploadPath, status: remote.status }));
    return false;
  }
  const contentType = mediaType(remote.headers.get("content-type")) || contentTypeForKey(key);
  const length = Number(remote.headers.get("content-length"));
  if (!key.endsWith(".vtt") && Number.isFinite(length) && length >= 0) {
    const current = await bucket.head(key);
    if (current && current.size === length) {
      await remote.body.cancel?.();
      return true;
    }
  }
  await bucket.put(key, remote.body, { httpMetadata: { contentType } });
  console.log(JSON.stringify({ message: "upload_stored", key }));
  return true;
}

async function fetchOriginUpload(request, origin, key, fetchImpl) {
  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  headers.set("user-agent", "LangoClass");
  return fetchImpl(new URL(`/${key}`, origin), { method: request.method, headers });
}

// If-None-Match is only applied once the object is already in R2. Forwarding it
// on a miss lets the classroom server answer 304, and the file is never stored.

function objectResponse(object, request, { head = false } = {}) {
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  if (!headers.get("content-type")) headers.set("content-type", contentTypeForKey(object.key));
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("x-upload-store", "r2");
  headers.set("cache-control", String(object.key || "").endsWith(".vtt") ? "no-cache" : "public, max-age=86400");
  const askedForRange = request.headers.has("range");
  if (askedForRange && object.range) {
    const range = contentRangeHeader(object);
    if (range) headers.set("content-range", range);
  }
  const hasBody = !head && "body" in object && object.body;
  let status = 200;
  if (!head && !("body" in object)) status = request.headers.get("if-none-match") ? 304 : 412;
  else if (askedForRange && object.range && hasBody) status = 206;
  return new Response(hasBody ? object.body : null, { status, headers });
}

function contentRangeHeader(object) {
  const size = Number(object.size);
  if (!Number.isFinite(size)) return "";
  if (Number.isFinite(object.range?.suffix)) {
    const length = object.range.suffix;
    const start = Math.max(0, size - length);
    return `bytes ${start}-${size - 1}/${size}`;
  }
  const start = Number(object.range?.offset) || 0;
  const length = Number.isFinite(object.range?.length) ? object.range.length : size - start;
  const end = start + length - 1;
  return `bytes ${start}-${end}/${size}`;
}

function mediaType(value) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  if (!type || type === "text/html") return "";
  return type;
}
