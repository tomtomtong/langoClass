const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const sharp = require("sharp");
const { PDFParse } = require("pdf-parse");
const materialExtract = require("./material-extract");

const MAX_ASSETS_PER_FILE = 40;
const MAX_VISION_PAGES = 8;
const MIN_IMAGE_DIMENSION = 72;
const VISION_CROP_MIN_REGION = 0.08;

function makeAssetId() {
  return `mat-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function sanitizeLabel(text, fallback = "Image") {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function detectImageExt(buffer) {
  if (!buffer?.length) return "jpg";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "gif";
  if (buffer.length > 12 && buffer.slice(8, 12).toString() === "WEBP") return "webp";
  return "jpg";
}

async function normalizeAssetBuffer(buffer) {
  if (!buffer?.length) return null;
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    if (meta.width < MIN_IMAGE_DIMENSION && meta.height < MIN_IMAGE_DIMENSION) return null;
    const jpeg = await sharp(buffer).rotate().jpeg({ quality: 88 }).toBuffer();
    return { buffer: jpeg, ext: "jpg", width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

function persistAssetBuffer(candidate, uploadsMaterialDir, seenHashes) {
  const normalized = candidate?.normalized;
  if (!normalized?.buffer?.length) return null;
  const digest = hashBuffer(normalized.buffer);
  if (seenHashes.has(digest)) return null;
  seenHashes.add(digest);

  pathsEnsureDir(uploadsMaterialDir);
  const id = makeAssetId();
  const filename = `${id}.${normalized.ext}`;
  const filePath = path.join(uploadsMaterialDir, filename);
  fs.writeFileSync(filePath, normalized.buffer);

  return {
    id,
    url: `/uploads/material/${filename}`,
    label: sanitizeLabel(candidate.label),
    sourceFile: candidate.sourceFile || "",
    page: candidate.page ?? null,
    width: normalized.width || null,
    height: normalized.height || null,
    origin: candidate.origin || "embedded",
    description: candidate.description || "",
  };
}

function pathsEnsureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function bufferFromEmbeddedImage(image, pageNumber, sourceFile) {
  if (!image?.data?.length) return null;
  const raw = Buffer.from(image.data);
  const normalized = await normalizeAssetBuffer(raw);
  if (!normalized) return null;
  const label = `${path.basename(sourceFile, path.extname(sourceFile))} · page ${pageNumber}${
    image.name ? ` · ${image.name}` : ""
  }`;
  return {
    normalized,
    label,
    sourceFile,
    page: pageNumber,
    origin: "pdf-embedded",
    description: `Embedded image ${image.width}×${image.height}px`,
  };
}

async function extractPdfEmbeddedImages(buffer, sourceFile) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getImage({
    imageBuffer: true,
    imageDataUrl: false,
    imageThreshold: MIN_IMAGE_DIMENSION,
    first: 30,
  });
  const out = [];
  for (const page of result?.pages || []) {
    for (const image of page.images || []) {
      const entry = await bufferFromEmbeddedImage(image, page.pageNumber, sourceFile);
      if (entry) out.push(entry);
      if (out.length >= MAX_ASSETS_PER_FILE) return out;
    }
  }
  return out;
}

async function extractZipMediaImages(buffer, sourceFile, mediaPrefix, originLabel) {
  const zip = new AdmZip(buffer);
  const out = [];
  let index = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.toLowerCase().startsWith(mediaPrefix)) continue;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(entry.entryName)) continue;
    const raw = entry.getData();
    const normalized = await normalizeAssetBuffer(raw);
    if (!normalized) continue;
    index += 1;
    out.push({
      normalized,
      label: `${path.basename(sourceFile, path.extname(sourceFile))} · ${originLabel} ${index}`,
      sourceFile,
      page: index,
      origin: originLabel,
      description: path.basename(entry.entryName),
    });
    if (out.length >= MAX_ASSETS_PER_FILE) break;
  }
  return out;
}

async function extractPptxImages(buffer, sourceFile) {
  return extractZipMediaImages(buffer, sourceFile, "ppt/media/", "pptx");
}

async function extractDocxImages(buffer, sourceFile) {
  return extractZipMediaImages(buffer, sourceFile, "word/media/", "docx");
}

async function extractUploadImage(buffer, sourceFile) {
  const normalized = await normalizeAssetBuffer(buffer);
  if (!normalized) return [];
  return [
    {
      normalized,
      label: path.basename(sourceFile),
      sourceFile,
      page: null,
      origin: "upload",
      description: "Uploaded image",
    },
  ];
}

function parseVisionCropJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed?.regions) ? parsed.regions : Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return Array.isArray(parsed?.regions) ? parsed.regions : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

async function visionDetectRegions(pageBuffer, { sourceFile, pageNumber, materialHint, visionComplete, apiKey, model }) {
  if (typeof visionComplete !== "function" || !apiKey) return [];
  const mime = "image/jpeg";
  const base64 = pageBuffer.toString("base64");
  const messages = [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${base64}` },
        },
        {
          type: "text",
          text:
            "You analyze textbook/worksheet page images for a language-learning CMS.\n" +
            "Find distinct photos, diagrams, or illustrations that could become quiz question images.\n" +
            "Ignore tiny icons, logos, decorative borders, and page numbers.\n" +
            (materialHint ? `Teacher focus: ${materialHint}\n` : "") +
            `Source file: ${sourceFile}, page ${pageNumber}.\n` +
            'Return ONLY JSON: {"regions":[{"label":"short description","box":{"x":0.12,"y":0.08,"w":0.35,"h":0.42}}]}\n' +
            "box coordinates are normalized 0-1 relative to page width/height. Max 6 regions.",
        },
      ],
    },
  ];
  const reply = await visionComplete(apiKey, model, messages, 1200);
  return parseVisionCropJson(reply);
}

async function cropRegionsFromPage(pageBuffer, regions, meta) {
  const out = [];
  const image = sharp(pageBuffer);
  const { width, height } = await image.metadata();
  if (!width || !height) return out;

  for (const region of regions.slice(0, 6)) {
    const box = region?.box || {};
    const x = Math.max(0, Math.min(1, Number(box.x) || 0));
    const y = Math.max(0, Math.min(1, Number(box.y) || 0));
    const w = Math.max(VISION_CROP_MIN_REGION, Math.min(1 - x, Number(box.w) || 0));
    const h = Math.max(VISION_CROP_MIN_REGION, Math.min(1 - y, Number(box.h) || 0));
    const left = Math.floor(x * width);
    const top = Math.floor(y * height);
    const cropW = Math.max(MIN_IMAGE_DIMENSION, Math.floor(w * width));
    const cropH = Math.max(MIN_IMAGE_DIMENSION, Math.floor(h * height));
    if (cropW < MIN_IMAGE_DIMENSION || cropH < MIN_IMAGE_DIMENSION) continue;

    try {
      const cropped = await sharp(pageBuffer)
        .extract({ left, top, width: Math.min(cropW, width - left), height: Math.min(cropH, height - top) })
        .jpeg({ quality: 88 })
        .toBuffer();
      const normalized = await normalizeAssetBuffer(cropped);
      if (!normalized) continue;
      out.push({
        normalized,
        label: sanitizeLabel(region?.label, `Page ${meta.pageNumber} figure`),
        sourceFile: meta.sourceFile,
        page: meta.pageNumber,
        origin: "vision-crop",
        description: `Cropped from page ${meta.pageNumber}`,
      });
    } catch {
      /* skip invalid crop */
    }
  }
  return out;
}

async function extractPdfVisionCrops(buffer, sourceFile, options = {}) {
  const parser = new PDFParse({ data: buffer });
  const shots = await parser.getScreenshot({
    imageBuffer: true,
    imageDataUrl: false,
    scale: 1.25,
    first: MAX_VISION_PAGES,
  });
  const out = [];
  for (const page of shots?.pages || []) {
    if (!page?.data?.length) continue;
    const pageBuffer = Buffer.from(page.data);
    const regions = await visionDetectRegions(pageBuffer, {
      sourceFile,
      pageNumber: page.pageNumber,
      materialHint: options.materialHint,
      visionComplete: options.visionComplete,
      apiKey: options.apiKey,
      model: options.model,
    });
    if (!regions.length) continue;
    out.push(
      ...(await cropRegionsFromPage(pageBuffer, regions, {
        sourceFile,
        pageNumber: page.pageNumber,
      }))
    );
    if (out.length >= MAX_ASSETS_PER_FILE) break;
  }
  return out.slice(0, MAX_ASSETS_PER_FILE);
}

async function extractMaterialImageAssets(uploadedFile, options = {}) {
  const buffer = uploadedFile?.buffer;
  const sourceFile = uploadedFile?.originalname || "upload";
  if (!buffer?.length) return [];

  const format = materialExtract.detectFormat(sourceFile, uploadedFile.mimetype);
  let candidates = [];

  if (format === "pdf") {
    candidates = await extractPdfEmbeddedImages(buffer, sourceFile);
    const embeddedCount = candidates.length;
    if (
      embeddedCount < 3 &&
      options.enableVisionCrop &&
      typeof options.visionComplete === "function" &&
      options.apiKey
    ) {
      const crops = await extractPdfVisionCrops(buffer, sourceFile, options);
      candidates = candidates.concat(crops);
    }
  } else if (format === "pptx") {
    candidates = await extractPptxImages(buffer, sourceFile);
  } else if (format === "docx") {
    candidates = await extractDocxImages(buffer, sourceFile);
  } else if (materialExtract.isImageFormat(format)) {
    candidates = await extractUploadImage(buffer, sourceFile);
  }

  const uploadsMaterialDir = options.uploadsMaterialDir;
  if (!uploadsMaterialDir) return [];

  const seenHashes = new Set();
  const assets = [];
  for (const candidate of candidates) {
    const asset = persistAssetBuffer(candidate, uploadsMaterialDir, seenHashes);
    if (asset) assets.push(asset);
  }
  return assets;
}

function buildImageAssetCatalogBlock(imageAssets) {
  const list = Array.isArray(imageAssets) ? imageAssets : [];
  if (!list.length) return "";
  const lines = list.map(
    (asset) =>
      `- ${asset.id}: ${asset.label}${asset.page ? ` (page ${asset.page})` : ""}${
        asset.sourceFile ? ` · from ${asset.sourceFile}` : ""
      }`
  );
  return (
    "IMAGE ASSET CATALOG — when a question needs a picture, set imageRef to one of these ids (or null if none fits):\n" +
    `${lines.join("\n")}\n\n`
  );
}

function resolveExerciseImageRefs(exercises, imageAssets) {
  const byId = new Map((imageAssets || []).map((asset) => [asset.id, asset.url]));
  return (Array.isArray(exercises) ? exercises : []).map((exercise) => ({
    ...exercise,
    items: (exercise.items || []).map((item) => {
      const ref = String(item?.imageRef || "").trim();
      const direct = String(item?.image || item?.imageUrl || "").trim();
      const resolved = (ref && byId.get(ref)) || direct || null;
      const next = { ...item };
      delete next.imageRef;
      if (resolved) next.image = resolved;
      else if ("image" in next) next.image = null;
      return next;
    }),
  }));
}

module.exports = {
  MAX_ASSETS_PER_FILE,
  extractMaterialImageAssets,
  buildImageAssetCatalogBlock,
  resolveExerciseImageRefs,
  normalizeAssetBuffer,
};
