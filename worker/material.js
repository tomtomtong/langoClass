// POST /api/cms/extract-material, as server.js served it: turns uploaded
// lesson files, pasted text or a caption file into markdown for the exercise
// generator, and keeps pictures from the files as material image assets.
// PDF, Word, HEIC and image work runs in the media container; pictures are
// read with a vision model through Inworld's chat API (the newcms router takes
// no images). Short WAV/MP3 audio goes straight to speech recognition; video
// and longer audio are cut into pieces by the container's ffmpeg first
// (media-speech.js). PowerPoint needs a zip reader the container does not
// have yet, so that says so.
// POST /api/cms/compress-material-video shrinks a lesson video before upload.
import formats from "../lib/material-format.js";
import { transcribe } from "./ai.js";
import { extensionOf, openUpload, randomPart, storeUpload, uploadUrl } from "./course-files.js";
import { json, requireTeacher } from "./d1-store.js";
import {
  MEDIA_MAX_BYTES,
  MediaError,
  captionsFromMedia,
  compressVideo,
  openVideo,
  storeCaptions,
  tooLarge,
  transcribeMedia,
} from "./media-speech.js";

const EXTRACT_PATH = "/api/cms/extract-material";
const COMPRESS_PATH = "/api/cms/compress-material-video";
const MIN_PDF_TEXT_CHARS = 80;
const MAX_PDF_OCR_PAGES = 12;
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const VISION_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const AUDIO_DIRECT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_VISION_MODEL = "google-ai-studio/gemini-2.5-flash";
const INWORLD_CHAT_URL = "https://api.inworld.ai/v1/chat/completions";
const VISION_TIMEOUT_MS = 120000;
const IMAGE_PROMPT =
  "Convert this lesson image into clean markdown for a language-learning course generator.\n" +
  "Include:\n" +
  "- A short ## heading describing the image topic\n" +
  "- All visible text verbatim (preserve vocabulary lists, headings, labels)\n" +
  "- Brief descriptions of diagrams or illustrations only when needed for context\n" +
  "- Use markdown headings, bullet lists, and tables where appropriate\n" +
  "Return markdown only, no commentary.";

class MaterialError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function handleMaterialApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");
  if (request.method.toUpperCase() !== "POST" || (path !== EXTRACT_PATH && path !== COMPRESS_PATH)) return null;
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  if (path === COMPRESS_PATH) return compressUpload(request, env);

  let fields;
  let files;
  try {
    ({ fields, files } = await readInput(request));
  } catch {
    return json({ message: "Upload failed." }, 400);
  }
  const maxChars = Number(fields.maxChars) > 0 ? Number(fields.maxChars) : undefined;
  const language = sttLanguage(fields.language);

  try {
    if (files.length) return await extractFiles(env, files, { language, maxChars });

    const pasted = String(fields.text || "").trim();
    if (pasted) {
      const result = formats.truncateMaterial(pasted, maxChars);
      return json({ ok: true, source: "text", text: result.text, truncated: result.truncated, originalLength: result.originalLength });
    }

    const captionUrl = String(fields.captionUrl || "").trim();
    if (captionUrl) {
      const stored = await openUpload(env, captionUrl);
      if (!stored) throw new MaterialError("Could not read source captions (404).", 500);
      const result = formats.truncateMaterial(formats.extractVtt(await new Response(stored.body).text()));
      if (!result.text) throw new MaterialError("Caption file has no readable text.");
      return json({
        ok: true,
        source: "caption",
        captionUrl,
        text: result.text,
        truncated: result.truncated,
        originalLength: result.originalLength,
      });
    }

    const videoUrl = String(fields.videoUrl || "").trim();
    if (videoUrl) {
      const captions = await captionsFromMedia(env, await openVideo(env, videoUrl), language);
      const captionUrl = await storeCaptions(env, captions.vtt);
      const result = formats.truncateMaterial(formats.extractVtt(captions.vtt));
      return json({
        ok: true,
        source: "video",
        videoUrl,
        captionUrl,
        cueCount: captions.cueCount,
        text: result.text,
        truncated: result.truncated,
        originalLength: result.originalLength,
      });
    }
    return json({ message: "Provide a file, pasted text, captionUrl, or videoUrl." }, 400);
  } catch (error) {
    const status = error instanceof MaterialError || error instanceof MediaError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Material extraction failed.";
    console.error(JSON.stringify({ message: "extract_material_failed", error: message }));
    return json({ message: message || "Material extraction failed." }, status);
  }
}

async function readInput(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("multipart/form-data")) {
    const body = type.includes("json") ? (await request.json()) || {} : {};
    return { fields: body, files: [] };
  }
  const form = await request.formData();
  const fields = {};
  const files = [];
  for (const [key, value] of form.entries()) {
    if (value && typeof value === "object" && typeof value.arrayBuffer === "function") {
      if (value.size) files.push(value);
    } else {
      fields[key] = value;
    }
  }
  return { fields, files: files.slice(0, 21) };
}

async function extractFiles(env, files, { language, maxChars }) {
  const started = Date.now();
  const extracted = [];
  const imageAssets = [];
  let video = null;
  for (const file of files) {
    const { result, source, images, videoMeta } = await extractFile(env, file, language);
    extracted.push({ result, source });
    imageAssets.push(...images);
    if (videoMeta) video = videoMeta;
  }
  const combined =
    extracted.length === 1
      ? extracted[0].result.text
      : extracted.map(({ result }) => `## ${result.filename}\n\n${result.text}`).join("\n\n---\n\n");
  const truncated = formats.truncateMaterial(combined, maxChars);
  const filenames = extracted.map(({ result }) => result.filename).filter(Boolean);
  const methods = extracted.map(({ result }) => result.extractionMethod).filter(Boolean);
  return json({
    ok: true,
    source: extracted.length > 1 ? "files" : extracted[0]?.source || "file",
    filename: filenames.join(", "),
    filenames,
    fileCount: extracted.length,
    format: extracted.length === 1 ? extracted[0].result.format : undefined,
    text: truncated.text,
    truncated: truncated.truncated,
    originalLength: truncated.originalLength,
    videoUrl: video?.videoUrl,
    captionUrl: video?.captionUrl,
    cueCount: video?.cueCount,
    extraction: {
      durationMs: Date.now() - started,
      methods,
      pageCount: extracted.reduce((sum, { result }) => sum + (result.pageCount || 0), 0),
      pagesProcessed: extracted.reduce((sum, { result }) => sum + (result.pagesProcessed || 0), 0),
      usedVisionOcr: methods.includes("pdf-ocr"),
    },
    imageAssets,
    imageAssetCount: imageAssets.length,
  });
}

async function extractFile(env, file, language) {
  const filename = String(file.name || "file");
  const format = formats.detectFormat(filename, file.type);
  const base = { filename, format, pageCount: 0, pagesProcessed: 0 };
  if (formats.isVideoFormat(format, file.type)) return extractVideo(env, file, base, language);
  if (file.size > UPLOAD_MAX_BYTES) throw new MaterialError(`${filename} is too large (max ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB).`);

  if (formats.isAudioFormat(format, file.type)) {
    const direct = ["mp3", "wav"].includes(format) && file.size <= AUDIO_DIRECT_MAX_BYTES;
    const transcript = direct
      ? await transcribe(env, { audioBase64: bytesToBase64(await file.arrayBuffer()), format, language })
      : await transcribeMedia(env, await file.arrayBuffer(), language);
    const title = filename.replace(/\.[^.]+$/, "") || "Audio transcript";
    return {
      result: { ...base, text: formats.normalizeWhitespace(`## ${title}\n\n${String(transcript || "").trim()}`), extractionMethod: format },
      source: "audio",
      images: [],
    };
  }

  if (formats.isImageFormat(format)) {
    let bytes = await file.arrayBuffer();
    let mime = formats.imageMimeFromFormat(format, file.type);
    if (formats.isHeicLikeFormat(format, file.type)) {
      const converted = await callMedia(env, "/heic", bytes, mime);
      if (!converted.ok) {
        const reason = (await converted.text()).trim();
        throw new MaterialError(
          `Could not read ${filename}. Try exporting it as JPG from Photos, or upload a .jpg/.png instead. (${reason || "conversion failed"})`
        );
      }
      bytes = await converted.arrayBuffer();
      mime = "image/jpeg";
    }
    if (bytes.byteLength > VISION_IMAGE_MAX_BYTES) {
      const compressed = await callMedia(env, "/image/compress", bytes, mime, {
        "x-max-bytes": String(VISION_IMAGE_MAX_BYTES),
        "x-mime": mime,
        "x-filename": filename,
      });
      if (compressed.ok) {
        bytes = await compressed.arrayBuffer();
        mime = compressed.headers.get("x-mime") || "image/jpeg";
      }
    }
    const text = await describeImage(env, bytes, mime, filename);
    return {
      result: { ...base, text, extractionMethod: "image-vision" },
      source: "image",
      images: await storeUploadedImage(env, bytes, filename),
    };
  }

  if (format === "pdf") return extractPdf(env, file, base);
  if (format === "docx") {
    const bytes = await file.arrayBuffer();
    const response = await callMedia(env, "/docx", bytes, file.type);
    if (!response.ok) throw new MaterialError(`Could not read ${filename}.`, 500);
    const text = formats.normalizeWhitespace((await response.json()).text);
    if (!text) throw new MaterialError(`No readable text found in ${filename}.`);
    return { result: { ...base, text, extractionMethod: "docx" }, source: "file", images: await documentImages(env, "docx", bytes, filename) };
  }
  if (format === "pptx") {
    throw new MaterialError(`Reading PowerPoint (${filename}) is not available yet. Save it as PDF and upload that instead.`, 501);
  }

  const raw = await file.text();
  const text = format === "vtt" ? formats.extractVtt(raw) : formats.extractPlainText(raw);
  if (!text) throw new MaterialError(`No readable text found in ${filename}.`);
  return { result: { ...base, text, extractionMethod: format }, source: "file", images: [] };
}

// As Node did: shrink the video, keep it under /uploads/videos/, make captions
// from its sound, and use the caption text as the material.
async function extractVideo(env, file, base, language) {
  if (file.size > MEDIA_MAX_BYTES) throw new MaterialError(tooLarge());
  const { bytes, compressed } = await compressVideo(env, await file.arrayBuffer(), base.filename);
  const ext = compressed ? ".mp4" : extensionOf(base.filename) || ".mp4";
  const videoUrl = uploadUrl("videos", `material-${Date.now()}-${randomPart(8)}${ext}`);
  await storeUpload(env, videoUrl, bytes, { contentType: compressed ? "video/mp4" : file.type || undefined });
  const captions = await captionsFromMedia(env, bytes, language);
  const captionUrl = await storeCaptions(env, captions.vtt);
  const text = formats.extractVtt(captions.vtt);
  if (!text) throw new MaterialError("Speech recognition found no speech in this video.");
  const title = base.filename.replace(/\.[^.]+$/, "") || "Video transcript";
  return {
    result: { ...base, text: formats.normalizeWhitespace(`## ${title}\n\n${text}`), extractionMethod: "video" },
    source: "video",
    images: [],
    videoMeta: { videoUrl, captionUrl, cueCount: captions.cueCount },
  };
}

// The CMS sends videos over 8 MB here first and uploads what comes back.
async function compressUpload(request, env) {
  let file;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return json({ message: "Upload failed." }, 400);
  }
  if (!file || typeof file === "string" || !file.size) return json({ message: "No video file received." }, 400);
  const filename = String(file.name || "video.mp4");
  if (!formats.isVideoFormat(formats.detectFormat(filename, file.type), file.type)) {
    return json({ message: "Only video files can be compressed on this endpoint." }, 400);
  }
  if (file.size > MEDIA_MAX_BYTES) return json({ message: tooLarge() }, 400);
  try {
    const { bytes, compressed } = await compressVideo(env, await file.arrayBuffer(), filename);
    return new Response(bytes, {
      headers: {
        "content-type": "video/mp4",
        "x-original-bytes": String(file.size),
        "x-output-bytes": String(bytes.byteLength),
        "x-compressed": compressed ? "1" : "0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video compression failed.";
    console.error(JSON.stringify({ message: "compress_material_video_failed", error: message }));
    return json({ message }, error instanceof MediaError ? error.status : 500);
  }
}

async function extractPdf(env, file, base) {
  const bytes = await file.arrayBuffer();
  const response = await callMedia(env, "/pdf", bytes, "application/pdf");
  if (!response.ok) throw new MaterialError(`Could not read ${base.filename}.`, 500);
  const text = formats.normalizeWhitespace((await response.json()).text);
  const images = await documentImages(env, "pdf", bytes, base.filename);
  if (text.length >= MIN_PDF_TEXT_CHARS) {
    return { result: { ...base, text, extractionMethod: "pdf-text" }, source: "file", images };
  }

  // A scanned PDF: read each page picture with the vision model.
  visionKey(env);
  const shots = await callMedia(env, "/pdf/screenshots", bytes, "application/pdf");
  if (!shots.ok) throw new MaterialError(`Could not read ${base.filename}.`, 500);
  const pages = ((await shots.json()).pages || []).filter((page) => page?.base64).slice(0, MAX_PDF_OCR_PAGES);
  const blocks = [];
  for (const page of pages) {
    const pageBytes = base64ToBytes(page.base64);
    const markdown = await describeImage(env, pageBytes, page.mime || "image/png", `${base.filename} · page ${page.pageNumber}`);
    if (markdown) blocks.push(`## Page ${page.pageNumber}\n\n${markdown}`);
  }
  const ocr = formats.normalizeWhitespace(blocks.join("\n\n"));
  if (!ocr) throw new MaterialError(`No readable text found in ${base.filename}.`);
  return {
    result: { ...base, text: ocr, extractionMethod: "pdf-ocr", pageCount: pages.length, pagesProcessed: blocks.length },
    source: "file",
    images,
  };
}

async function describeImage(env, bytes, mime, label) {
  const key = visionKey(env);
  const model = String(env.INWORLD_VISION_MODEL || "").trim() || DEFAULT_VISION_MODEL;
  const response = await fetch(INWORLD_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${bytesToBase64(bytes)}` } },
            { type: "text", text: `${IMAGE_PROMPT}\n\nImage filename: ${label}` },
          ],
        },
      ],
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.message || data?.message || `HTTP ${response.status}`;
    throw new MaterialError(`Image conversion (${model}): ${reason}`, 500);
  }
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((part) => part?.text || "").join("") : String(content || "");
  const markdown = formats.normalizeWhitespace(text);
  if (!markdown) throw new MaterialError("Could not extract markdown from this image.");
  return markdown;
}

function visionKey(env) {
  const key = String(env.INWORLD_API_KEY || "").trim();
  if (!key) {
    throw new MaterialError("Reading pictures and scanned PDFs needs INWORLD_API_KEY on the Worker. Paste the text instead.");
  }
  return key;
}

async function storeUploadedImage(env, bytes, filename) {
  if (!env.UPLOADS) return [];
  const response = await callMedia(env, "/image/normalize", bytes, "application/octet-stream");
  if (!response.ok) return [];
  const image = await response.json();
  if (!image?.jpeg) return [];
  return [await storeAsset(env, image, { label: filename, sourceFile: filename, origin: "upload", description: "Uploaded image" })];
}

async function documentImages(env, kind, bytes, filename) {
  if (!env.UPLOADS) return [];
  const response = await callMedia(env, kind === "pdf" ? "/pdf/images" : "/docx/images", bytes, "application/octet-stream");
  if (!response.ok) return [];
  const stem = filename.replace(/\.[^.]+$/, "");
  const images = [];
  for (const image of (await response.json()).images || []) {
    if (!image?.jpeg) continue;
    images.push(
      await storeAsset(env, image, {
        label: image.name ? `${stem} · ${image.name}` : stem,
        sourceFile: filename,
        page: image.pageNumber ?? null,
        origin: kind === "pdf" ? "pdf-embedded" : "docx",
        description: image.name || "",
      })
    );
  }
  return images;
}

async function storeAsset(env, image, meta) {
  const id = `mat-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `uploads/material/${id}.jpg`;
  await env.UPLOADS.put(key, base64ToBytes(image.jpeg), { httpMetadata: { contentType: "image/jpeg" } });
  return {
    id,
    url: `/${key}`,
    label: meta.label,
    sourceFile: meta.sourceFile,
    page: meta.page ?? null,
    width: image.width || null,
    height: image.height || null,
    origin: meta.origin,
    description: meta.description || "",
  };
}

async function callMedia(env, pathname, bytes, contentType, headers = {}) {
  if (!env.MEDIA) throw new MaterialError("The media container is not configured.", 500);
  return env.MEDIA.getByName("media").fetch(
    new Request(`http://container${pathname}`, {
      method: "POST",
      body: bytes,
      headers: { "content-type": contentType || "application/octet-stream", ...headers },
    })
  );
}

// server.js normalizeBuzzinSttLanguage with English as the fallback.
function sttLanguage(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase()
    .split("-")[0];
  return /^[a-z]{2,3}$/.test(code) ? code : "en";
}

function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
