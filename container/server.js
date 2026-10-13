const http = require("http");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const { convertHeicToJpeg } = require("./heic");
const { compressMaterialImageBuffer } = require("./compress");
const { processGeneratedPathTile } = require("./path-tile");

const PORT = Number(process.env.PORT || 8080);
const MAX_BYTES = 80 * 1024 * 1024;
const MIN_IMAGE_DIMENSION = 72;

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
      return sendJson(res, 200, { images: await docxImages(body) });
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

async function pdfImages(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getImage({
      imageBuffer: true,
      imageDataUrl: false,
      imageThreshold: MIN_IMAGE_DIMENSION,
      first: 30,
    });
    const images = [];
    for (const page of result?.pages || []) {
      for (const image of page.images || []) {
        if (!image?.data?.length) continue;
        const normalized = await normalizeImage(Buffer.from(image.data));
        if (!normalized.jpeg) continue;
        images.push({
          pageNumber: page.pageNumber,
          name: image.name || "",
          width: normalized.width,
          height: normalized.height,
          jpeg: normalized.jpeg,
        });
        if (images.length >= 40) return images;
      }
    }
    return images;
  } finally {
    await parser.destroy?.();
  }
}

async function docxImages(buffer) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const images = [];
  const names = Object.keys(zip.files)
    .filter((name) => name.toLowerCase().startsWith("word/media/") && /\.(jpe?g|png|webp|gif)$/i.test(name))
    .sort();
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

async function normalizeImage(buffer) {
  const sharp = require("sharp");
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return { jpeg: null };
    if (meta.width < MIN_IMAGE_DIMENSION && meta.height < MIN_IMAGE_DIMENSION) return { jpeg: null };
    const jpeg = await sharp(buffer).rotate().jpeg({ quality: 88 }).toBuffer();
    return { jpeg: jpeg.toString("base64"), width: meta.width, height: meta.height };
  } catch {
    return { jpeg: null };
  }
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
