const http = require("http");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const { convertHeicToJpeg } = require("./heic");
const { compressMaterialImageBuffer } = require("./compress");
const { processGeneratedPathTile } = require("./path-tile");
const { audioChunks, compressVideo } = require("./ffmpeg");
const { MIN_IMAGE_DIMENSION, normalizeImage } = require("./image");
const path = require("path");
const { Worker } = require("worker_threads");

const PORT = Number(process.env.PORT || 8080);
const MAX_BYTES = 100 * 1024 * 1024;
// A PDF's pictures are optional; past this the text goes back without them.
const PDF_IMAGES_TIMEOUT_MS = 75 * 1000;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://container");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, "ok", "text/plain");
    }
    if (req.method !== "POST") return send(res, 405, "Method not allowed", "text/plain");

    const body = await readBody(req);
    if (url.pathname === "/heic") {
      const jpeg = await convertHeicToJpeg(body);
      return send(res, 200, jpeg, "image/jpeg");
    }
    if (url.pathname === "/pdf") {
      const text = await extractPdfText(body);
      return sendJson(res, 200, { text });
    }
    if (url.pathname === "/pdf/screenshots") {
      return sendJson(res, 200, { pages: await pdfScreenshots(body) });
    }
    if (url.pathname === "/pdf/images") {
      return sendJson(res, 200, { images: await pdfImages(body) });
    }
    if (url.pathname === "/docx") {
      const result = await mammoth.convertToMarkdown({ buffer: body });
      return sendJson(res, 200, { text: String(result.value || "").replace(/\r/g, "").trim() });
    }
    if (url.pathname === "/docx/images") {
      return sendJson(res, 200, { images: await zipImages(body, "word/media/") });
    }
    if (url.pathname === "/pptx") {
      return sendJson(res, 200, { text: await pptxText(body) });
    }
    if (url.pathname === "/pptx/images") {
      return sendJson(res, 200, { images: await zipImages(body, "ppt/media/") });
    }
    if (url.pathname === "/image/normalize") {
      return sendJson(res, 200, await normalizeImage(body));
    }
    if (url.pathname === "/image/compress") {
      const maxBytes = Number(req.headers["x-max-bytes"]) || 6 * 1024 * 1024;
      const compressed = await compressMaterialImageBuffer(body, maxBytes, {
        mimeType: String(req.headers["x-mime"] || ""),
        filename: String(req.headers["x-filename"] || ""),
      });
      res.setHeader("x-mime", compressed.mime);
      res.setHeader("x-compressed", compressed.compressed ? "1" : "0");
      return send(res, 200, compressed.buffer, compressed.mime || "image/jpeg");
    }
    if (url.pathname === "/image/path-tile") {
      const png = await processGeneratedPathTile(body);
      return send(res, 200, png, "image/png");
    }
    if (url.pathname === "/audio/chunks") {
      const seconds = Number(req.headers["x-chunk-seconds"]) || undefined;
      return sendJson(res, 200, { chunks: await audioChunks(body, { seconds }) });
    }
    if (url.pathname === "/video/compress") {
      const maxBytes = Number(req.headers["x-max-bytes"]) || 12 * 1024 * 1024;
      const result = await compressVideo(body, maxBytes, { filename: String(req.headers["x-filename"] || "") });
      res.setHeader("x-compressed", result.compressed ? "1" : "0");
      return send(res, 200, result.buffer, "video/mp4");
    }
    if (url.pathname === "/image/crop") {
      const regions = JSON.parse(String(req.headers["x-regions"] || "[]"));
      return sendJson(res, 200, { crops: await cropRegions(body, regions) });
    }
    return send(res, 404, "Not found", "text/plain");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "media_failed", error: message }));
    return send(res, 400, message, "text/plain");
  }
});

server.listen(PORT, "0.0.0.0");

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = Array.isArray(result?.pages) ? result.pages : [];
    if (pages.length) {
      return pages
        .map((page, index) => `## Page ${index + 1}\n\n${clean(page?.text || "")}`)
        .filter((block) => block.trim().length > 10)
        .join("\n\n");
    }
    return clean(result?.text || "");
  } finally {
    await parser.destroy?.();
  }
}

async function pdfScreenshots(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const shots = await parser.getScreenshot({
      imageBuffer: true,
      imageDataUrl: false,
      scale: 1.5,
      first: 12,
    });
    return (shots?.pages || [])
      .filter((page) => page?.data?.length)
      .map((page) => ({
        pageNumber: page.pageNumber,
        mime: page.data[0] === 0xff ? "image/jpeg" : "image/png",
        base64: Buffer.from(page.data).toString("base64"),
      }));
  } finally {
    await parser.destroy?.();
  }
}

function pdfImages(buffer) {
  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, "pdf-images.js"), { workerData: buffer });
    let done = false;
    const finish = (images, note) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (note) console.warn(`pdf images: ${note}`);
      worker.terminate().catch(() => {});
      resolve(images);
    };
    const timer = setTimeout(() => finish([], `stopped after ${PDF_IMAGES_TIMEOUT_MS / 1000} s`), PDF_IMAGES_TIMEOUT_MS);
    worker.once("message", (msg) => finish(msg.images || [], msg.error));
    worker.once("error", (error) => finish([], error.message));
    worker.once("exit", (code) => finish([], code ? `worker exited with ${code}` : ""));
  });
}

// Slide text in slide order, as lib/material-extract.js extractPptx did.
async function pptxText(buffer) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const slideNumber = (name) => Number(name.match(/slide(\d+)\.xml$/i)?.[1] || 0);
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const slides = [];
  for (const [index, name] of names.entries()) {
    const xml = await zip.files[name].async("string");
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    if (texts.length) slides.push(`## Slide ${index + 1}\n\n${texts.join("\n")}`);
  }
  return slides.join("\n\n");
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

// Pictures stored in a Word or PowerPoint file's media folder.
async function zipImages(buffer, mediaPrefix) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const images = [];
  const names = Object.keys(zip.files)
    .filter((name) => name.toLowerCase().startsWith(mediaPrefix) && /\.(jpe?g|png|webp|gif)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const name of names) {
    const raw = Buffer.from(await zip.files[name].async("uint8array"));
    const normalized = await normalizeImage(raw);
    if (!normalized.jpeg) continue;
    images.push({
      name: name.split("/").pop(),
      width: normalized.width,
      height: normalized.height,
      jpeg: normalized.jpeg,
    });
    if (images.length >= 40) break;
  }
  return images;
}

async function cropRegions(buffer, regions) {
  const sharp = require("sharp");
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) return [];
  const crops = [];
  for (const region of (Array.isArray(regions) ? regions : []).slice(0, 6)) {
    const box = region?.box || {};
    const x = Math.max(0, Math.min(1, Number(box.x) || 0));
    const y = Math.max(0, Math.min(1, Number(box.y) || 0));
    const w = Math.max(0.08, Math.min(1 - x, Number(box.w) || 0));
    const h = Math.max(0.08, Math.min(1 - y, Number(box.h) || 0));
    const left = Math.floor(x * meta.width);
    const top = Math.floor(y * meta.height);
    const width = Math.min(Math.max(MIN_IMAGE_DIMENSION, Math.floor(w * meta.width)), meta.width - left);
    const height = Math.min(Math.max(MIN_IMAGE_DIMENSION, Math.floor(h * meta.height)), meta.height - top);
    if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) continue;
    try {
      const cropped = await sharp(buffer).extract({ left, top, width, height }).jpeg({ quality: 88 }).toBuffer();
      const normalized = await normalizeImage(cropped);
      if (!normalized.jpeg) continue;
      crops.push({
        label: String(region?.label || "").slice(0, 120),
        jpeg: normalized.jpeg,
        width: normalized.width,
        height: normalized.height,
      });
    } catch {
      /* skip an invalid crop */
    }
  }
  return crops;
}

function clean(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error("File is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, contentType) {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json");
}
