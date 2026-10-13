import { developerAuth } from "./dev-account.js";

const EXTRACT_PATH = "/api/cms/extract-material";
const MAX_CHARS = 12000;
const MIN_PDF_TEXT_CHARS = 80;

export async function prepareMaterialRequest(request, env, url) {
  if (request.method !== "POST" || url.pathname !== EXTRACT_PATH) return null;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) return null;
  if (!env.MEDIA) return null;

  const auth = await authorizeTeacher(request, env);
  if (auth instanceof Response) return { response: auth };

  const original = request.clone();
  let form;
  try {
    form = await request.formData();
  } catch {
    return { request: original };
  }

  const files = [];
  for (const [key, value] of form.entries()) {
    if (value && typeof value === "object" && typeof value.arrayBuffer === "function" && value.name) {
      files.push({ key, file: value });
    }
  }
  if (!files.length) return { request: original };

  const kinds = files.map((item) => fileKind(item.file));
  if (kinds.every((kind) => kind === "pdf" || kind === "docx")) {
    const response = await extractDocuments(env, files);
    if (response) return { response };
    return { request: original };
  }
  if (kinds.some((kind) => kind === "heic")) {
    const rewritten = await rewriteHeicFiles(env, request, form, files);
    if (rewritten instanceof Response) return { response: rewritten };
    if (rewritten) return { request: rewritten, media: "container" };
  }
  return { request: original };
}

export function fileKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (name.endsWith(".docx") || type.includes("wordprocessingml")) return "docx";
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (name.endsWith(".heic") || name.endsWith(".heif") || type.includes("heic") || type.includes("heif")) {
    return "heic";
  }
  return "other";
}

export function truncateMaterial(text, maxChars = MAX_CHARS) {
  const normalized = String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false, originalLength: normalized.length };
  }
  return {
    text: `${normalized.slice(0, maxChars).trim()}\n\n[…truncated for generation]`,
    truncated: true,
    originalLength: normalized.length,
  };
}

async function extractDocuments(env, files) {
  const started = Date.now();
  const extracted = [];
  for (const item of files) {
    const kind = fileKind(item.file);
    const bytes = await item.file.arrayBuffer();
    const response = await callMedia(env, kind === "pdf" ? "/pdf" : "/docx", bytes, item.file.type || "application/octet-stream");
    if (!response.ok) return null;
    const payload = await response.json();
    const text = String(payload.text || "");
    if (kind === "pdf" && text.length < MIN_PDF_TEXT_CHARS) return null;
    const images = await documentImages(env, kind, bytes, item.file.name);
    extracted.push({
      filename: item.file.name,
      format: kind,
      text,
      images,
      extractionMethod: kind === "pdf" ? "pdf-text" : "docx",
    });
  }

  const combined =
    extracted.length === 1
      ? extracted[0].text
      : extracted.map((item) => `## ${item.filename}\n\n${item.text}`).join("\n\n---\n\n");
  const truncated = truncateMaterial(combined);
  return Response.json(
    {
      ok: true,
      source: extracted.length > 1 ? "files" : "file",
      filename: extracted.map((item) => item.filename).join(", "),
      filenames: extracted.map((item) => item.filename),
      fileCount: extracted.length,
      format: extracted.length === 1 ? extracted[0].format : undefined,
      text: truncated.text,
      truncated: truncated.truncated,
      originalLength: truncated.originalLength,
      extraction: {
        durationMs: Date.now() - started,
        methods: extracted.map((item) => item.extractionMethod),
        pageCount: 0,
        pagesProcessed: 0,
        usedVisionOcr: false,
      },
      imageAssets: extracted.flatMap((item) => item.images),
      imageAssetCount: extracted.reduce((sum, item) => sum + item.images.length, 0),
    },
    { headers: { "x-media-runtime": "container" } }
  );
}

async function rewriteHeicFiles(env, request, form, files) {
  const next = new FormData();
  let fileIndex = 0;
  for (const [key, value] of form.entries()) {
    const isFile = value && typeof value === "object" && typeof value.arrayBuffer === "function" && value.name;
    if (!isFile) {
      next.append(key, value);
      continue;
    }
    const match = files[fileIndex++];
    if (!match || fileKind(match.file) !== "heic") {
      next.append(key, value);
      continue;
    }
    const converted = await callMedia(env, "/heic", await match.file.arrayBuffer(), match.file.type || "image/heic");
    if (!converted.ok) {
      const message = (await converted.text()).trim();
      return Response.json(
        {
          message: `Could not read ${match.file.name || "HEIC image"}. Try exporting it as JPG from Photos, or upload a .jpg/.png instead. (${message || "conversion failed"})`,
        },
        { status: 400 }
      );
    }
    const bytes = await converted.arrayBuffer();
    const filename = match.file.name.replace(/\.hei[cf]$/i, ".jpg");
    next.append(key, new File([bytes], filename, { type: "image/jpeg" }));
  }
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return new Request(request.url, { method: "POST", headers, body: next });
}

async function documentImages(env, kind, bytes, filename) {
  if (!env.UPLOADS) return [];
  const response = await callMedia(env, kind === "pdf" ? "/pdf/images" : "/docx/images", bytes, "application/octet-stream");
  if (!response.ok) return [];
  const payload = await response.json();
  const images = [];
  for (const image of payload.images || []) {
    if (!image?.jpeg) continue;
    const id = `mat-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const key = `uploads/material/${id}.jpg`;
    const raw = Uint8Array.from(atob(image.jpeg), (char) => char.charCodeAt(0));
    await env.UPLOADS.put(key, raw, { httpMetadata: { contentType: "image/jpeg" } });
    const stem = filename.replace(/\.[^.]+$/, "");
    images.push({
      id,
      url: `/${key}`,
      label: image.name ? `${stem} · ${image.name}` : stem,
      sourceFile: filename,
      page: image.pageNumber ?? null,
      width: image.width || null,
      height: image.height || null,
      origin: kind === "pdf" ? "pdf-embedded" : "docx",
      description: image.name || "",
    });
  }
  return images;
}

async function callMedia(env, pathname, bytes, contentType) {
  return env.MEDIA.getByName("media").fetch(
    new Request(`http://container${pathname}`, {
      method: "POST",
      body: bytes,
      headers: { "content-type": contentType || "application/octet-stream" },
    })
  );
}

async function authorizeTeacher(request, env) {
  const dev = await developerAuth(request);
  if (dev) return dev;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (!token) return Response.json({ message: "Missing auth token." }, { status: 401 });
  const raw = request.headers.get("x-teacher-id");
  if (raw == null || !String(raw).trim()) return Response.json({ message: "Missing teacher id." }, { status: 400 });
  const base = String(env.CMS_API_BASE || "https://newcms.lango.ai").replace(/\/$/, "");
  const checked = await fetch(`${base}/api/teachers/${encodeURIComponent(String(raw).trim())}/classes`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!checked.ok) return Response.json({ message: "Invalid or expired token." }, { status: 401 });
  return { token, teacherId: String(raw).trim() };
}
