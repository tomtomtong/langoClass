// Uploaded files live in R2 and are served from there only.

const FOLDERS = new Set([
  "courses",
  "sections",
  "questions",
  "captions",
  "videos",
  "material",
  "community",
  "lectures",
  "slides",
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

export function uploadKey(pathname) {
  const pathOnly = String(pathname || "").split("?")[0].split("#")[0];
  if (!pathOnly.startsWith("/uploads/")) return "";
  const parts = pathOnly.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "uploads" || !FOLDERS.has(parts[1])) return "";
  if (parts.some((part) => part === "." || part === ".." || part.includes("\\"))) return "";
  if (!parts.slice(2).every((part) => /^[A-Za-z0-9._-]+$/.test(part))) return "";
  return parts.join("/");
}

export function contentTypeForKey(key) {
  const ext = String(key || "").split(".").pop()?.toLowerCase() || "";
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

// Uploads live in R2 only. The retired classroom server is no longer asked for
// files R2 does not have.
export async function serveUpload(request, { bucket } = {}) {
  const key = uploadKey(new URL(request.url).pathname);
  if (!key) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (!bucket) return new Response("Upload store is not configured", { status: 500 });

  if (request.method === "HEAD") {
    const head = await bucket.head(key);
    if (!head) return missingUpload(key);
    return objectResponse(head, request, { head: true });
  }

  const object = await bucket.get(key, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (object) return objectResponse(object, request);
  return missingUpload(key);
}

function missingUpload(key) {
  console.log(JSON.stringify({ message: "upload_missing", key }));
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}

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
