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
const IMAGE_REF_MIN_CONFIDENCE = 0.7;

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

function visionCropEnabled(options = {}) {
  return Boolean(
    options.enableVisionCrop && typeof options.visionComplete === "function" && options.apiKey
  );
}

function debugLogImageCrop(payload) {
  // #region agent log
  try {
    fs.appendFileSync(
      path.join(__dirname, "..", ".cursor", "debug-365eeb.log"),
      `${JSON.stringify({
        sessionId: "365eeb",
        timestamp: Date.now(),
        runId: "image-vision-crop",
        ...payload,
      })}\n`
    );
  } catch {
    /* ignore debug log failures */
  }
  // #endregion
}

async function extractUploadImageVisionCrops(buffer, sourceFile, options = {}) {
  if (!visionCropEnabled(options)) {
    debugLogImageCrop({
      location: "material-images.js:extractUploadImageVisionCrops",
      message: "vision crop skipped",
      hypothesisId: "IMG-CROP",
      data: { sourceFile, enabled: false },
    });
    return [];
  }
  const normalized = await normalizeAssetBuffer(buffer);
  if (!normalized?.buffer?.length) {
    debugLogImageCrop({
      location: "material-images.js:extractUploadImageVisionCrops",
      message: "vision crop skipped",
      hypothesisId: "IMG-CROP",
      data: { sourceFile, enabled: true, reason: "normalize-failed" },
    });
    return [];
  }

  try {
    const regions = await visionDetectRegions(normalized.buffer, {
      sourceFile,
      pageNumber: 1,
      materialHint: options.materialHint,
      visionComplete: options.visionComplete,
      apiKey: options.apiKey,
      model: options.model,
    });
    debugLogImageCrop({
      location: "material-images.js:extractUploadImageVisionCrops",
      message: "vision regions detected",
      hypothesisId: "IMG-CROP",
      data: {
        sourceFile,
        regionCount: regions.length,
        width: normalized.width,
        height: normalized.height,
      },
    });
    if (!regions.length) return [];

    const crops = await cropRegionsFromPage(normalized.buffer, regions, {
      sourceFile,
      pageNumber: 1,
    });
    debugLogImageCrop({
      location: "material-images.js:extractUploadImageVisionCrops",
      message: "vision crops built",
      hypothesisId: "IMG-CROP",
      data: {
        sourceFile,
        regionCount: regions.length,
        cropCount: crops.length,
        labels: crops.map((entry) => entry.label),
      },
    });
    return crops;
  } catch (err) {
    debugLogImageCrop({
      location: "material-images.js:extractUploadImageVisionCrops",
      message: "vision crop failed",
      hypothesisId: "IMG-CROP",
      data: { sourceFile, error: err?.message || String(err) },
    });
    return [];
  }
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
            "You analyze textbook/worksheet page images and photo collages for a language-learning CMS.\n" +
            "Find every distinct photo, diagram, or illustration panel that could become its own quiz question image.\n" +
            "For collages or grids with multiple separate pictures, return one region per picture (not the whole sheet).\n" +
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
    let visionCropCount = 0;
    if (visionCropEnabled(options)) {
      const crops = await extractUploadImageVisionCrops(buffer, sourceFile, options);
      visionCropCount = crops.length;
      if (crops.length) candidates = crops;
    }
    if (!candidates.length) {
      candidates = await extractUploadImage(buffer, sourceFile);
    }
    debugLogImageCrop({
      location: "material-images.js:extractMaterialImageAssets",
      message: "upload image asset extraction",
      hypothesisId: "IMG-CROP",
      data: {
        sourceFile,
        visionEnabled: visionCropEnabled(options),
        visionCropCount,
        candidateCount: candidates.length,
        origins: candidates.map((entry) => entry.origin),
      },
    });
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
    "IMAGE ASSET CATALOG — attach an image only when it clearly matches the question (same scene, object, or topic). " +
    "Set imageRef to a catalog id and imageRefConfidence as a decimal from 0.0 to 1.0 (not 0-100). " +
    `Only use imageRef when imageRefConfidence is at least ${IMAGE_REF_MIN_CONFIDENCE}; otherwise use null.\n` +
    `${lines.join("\n")}\n\n`
  );
}

function tokenizeMatchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function labelMatchConfidence(questionText, label) {
  const labelWords = tokenizeMatchText(label);
  if (!labelWords.length) return 0;
  const textWords = new Set(tokenizeMatchText(questionText));
  const overlap = labelWords.filter((word) => textWords.has(word)).length;
  return overlap / labelWords.length;
}

function questionTextFromItem(item) {
  return String(item?.title || item?.topic || item?.question || "").trim();
}

function inferCatalogRefFromValue(value, byId) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (byId.has(text)) return text;
  const fromUrl = text.match(/\/uploads\/material\/(mat-[A-Za-z0-9-]+)/i);
  if (fromUrl && byId.has(fromUrl[1])) return fromUrl[1];
  return null;
}

function parseImageRefConfidence(item) {
  const raw =
    item?.imageRefConfidence ??
    item?.imageConfidence ??
    item?.imageMatchConfidence ??
    item?.confidence;
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const pct = trimmed.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (pct) {
      const value = Number(pct[1]);
      if (Number.isFinite(value)) return Math.max(0, Math.min(1, value / 100));
    }
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function hasPendingImageMeta(item) {
  return Boolean(String(item?.imageRef || "").trim()) || parseImageRefConfidence(item) != null;
}

function parseAssignmentJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function assignImagesWithLlm(exercises, imageAssets, llmComplete, apiKey, model) {
  if (!Array.isArray(imageAssets) || !imageAssets.length || typeof llmComplete !== "function") {
    return exercises;
  }

  const entries = [];
  (Array.isArray(exercises) ? exercises : []).forEach((exercise, exIdx) => {
    if (exercise?.type === "video") return;
    (exercise.items || []).forEach((item, itemIdx) => {
      if (String(item?.image || item?.imageUrl || "").trim() || String(item?.imageRef || "").trim()) return;
      const text = questionTextFromItem(item);
      if (!text) return;
      entries.push({ key: `${exIdx}:${itemIdx}`, text });
    });
  });

  if (!entries.length) return exercises;

  const catalog = imageAssets.map((asset) => ({
    id: asset.id,
    label: asset.label,
    sourceFile: asset.sourceFile || "",
  }));

  const messages = [
    {
      role: "system",
      content:
        "You match quiz questions to image catalog entries. Return ONLY valid JSON. " +
        `Only assign when imageRefConfidence >= ${IMAGE_REF_MIN_CONFIDENCE}. Use exact catalog ids. ` +
        'Schema: {"assignments":[{"key":"0:0","imageRef":"mat-...","imageRefConfidence":0.82}]}',
    },
    {
      role: "user",
      content:
        "Match each question to the best catalog image when the scene or topic clearly fits. " +
        "Leave unrelated questions out of assignments.\n\n" +
        `Questions:\n${JSON.stringify(entries, null, 2)}\n\n` +
        `Image catalog:\n${JSON.stringify(catalog, null, 2)}`,
    },
  ];

  try {
    const reply = await llmComplete(
      apiKey,
      model,
      messages,
      Math.min(2500, 400 + entries.length * 80)
    );
    const parsed = parseAssignmentJson(reply);
    const rows = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
    if (!rows.length) {
      debugLogImageCrop({
        location: "material-images.js:assignImagesWithLlm",
        message: "no assignments returned",
        hypothesisId: "IMG-MATCH",
        data: { entryCount: entries.length },
      });
      return exercises;
    }

    const next = (Array.isArray(exercises) ? exercises : []).map((exercise) => ({
      ...exercise,
      items: [...(exercise.items || [])],
    }));
    let applied = 0;

    for (const row of rows) {
      const parts = String(row?.key || "").split(":");
      const exIdx = Number(parts[0]);
      const itemIdx = Number(parts[1]);
      if (!Number.isFinite(exIdx) || !Number.isFinite(itemIdx)) continue;
      const item = next[exIdx]?.items?.[itemIdx];
      if (!item) continue;
      const ref = String(row?.imageRef || "").trim();
      const confidence = parseImageRefConfidence({
        imageRefConfidence: row?.imageRefConfidence ?? row?.confidence,
      });
      if (!ref || confidence == null || confidence < IMAGE_REF_MIN_CONFIDENCE) continue;
      item.imageRef = ref;
      item.imageRefConfidence = confidence;
      applied += 1;
    }

    debugLogImageCrop({
      location: "material-images.js:assignImagesWithLlm",
      message: "llm image assignments applied",
      hypothesisId: "IMG-MATCH",
      data: { entryCount: entries.length, returned: rows.length, applied },
    });

    return next;
  } catch (err) {
    debugLogImageCrop({
      location: "material-images.js:assignImagesWithLlm",
      message: "llm image assignment failed",
      hypothesisId: "IMG-MATCH",
      data: { error: err?.message || String(err), entryCount: entries.length },
    });
    return exercises;
  }
}

function resolveItemImageMatch(item, imageAssets) {
  const assets = Array.isArray(imageAssets) ? imageAssets : [];
  if (!assets.length) {
    return { image: null, method: "no-assets", ref: null, confidence: null };
  }

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const byUrl = new Map(assets.map((asset) => [asset.url, asset]));
  const catalogUrls = new Set(assets.map((asset) => asset?.url).filter(Boolean));
  const current = String(item?.image || item?.imageUrl || "").trim();
  let ref = String(item?.imageRef || "").trim();
  if (!ref) ref = inferCatalogRefFromValue(current, byId) || "";
  const aiConfidence = parseImageRefConfidence(item);
  const questionText = questionTextFromItem(item);
  const pendingMeta = hasPendingImageMeta(item);

  if (ref && byId.has(ref) && aiConfidence != null && aiConfidence >= IMAGE_REF_MIN_CONFIDENCE) {
    return {
      image: byId.get(ref).url,
      method: "ai-ref",
      ref,
      confidence: aiConfidence,
    };
  }

  if (pendingMeta && aiConfidence != null && aiConfidence < IMAGE_REF_MIN_CONFIDENCE) {
    return {
      image: null,
      method: "skipped-low-confidence",
      ref: ref || null,
      confidence: aiConfidence,
    };
  }

  if (ref && byId.has(ref) && aiConfidence == null) {
    return {
      image: byId.get(ref).url,
      method: "ai-ref-implicit",
      ref,
      confidence: 0.75,
    };
  }

  if (current && catalogUrls.has(current) && aiConfidence != null && aiConfidence >= IMAGE_REF_MIN_CONFIDENCE) {
    const asset = byUrl.get(current);
    return {
      image: current,
      method: "ai-catalog-url",
      ref: asset?.id || ref || null,
      confidence: aiConfidence,
    };
  }

  if (current && catalogUrls.has(current)) {
    const asset = byUrl.get(current);
    if (asset && questionText) {
      const score = labelMatchConfidence(questionText, asset.label || asset.description || "");
      if (score >= IMAGE_REF_MIN_CONFIDENCE) {
        return {
          image: current,
          method: "url-label-match",
          ref: asset.id,
          confidence: score,
        };
      }
    }
  }

  if (questionText) {
    let best = null;
    for (const asset of assets) {
      const score = labelMatchConfidence(questionText, asset.label || asset.description || "");
      if (!best || score > best.score) best = { asset, score };
    }
    if (best && best.score >= IMAGE_REF_MIN_CONFIDENCE) {
      return {
        image: best.asset.url,
        method: "label-match",
        ref: best.asset.id,
        confidence: best.score,
      };
    }
  }

  if (current && catalogUrls.has(current) && !pendingMeta) {
    const asset = byUrl.get(current);
    return {
      image: current,
      method: "kept-ai-catalog-url",
      ref: asset?.id || ref || null,
      confidence: 0.75,
    };
  }

  if (current && catalogUrls.has(current) && pendingMeta) {
    return { image: null, method: "cleared-catalog-url", ref: ref || null, confidence: aiConfidence };
  }

  if (current) {
    return { image: current, method: "kept-non-catalog", ref: null, confidence: aiConfidence };
  }

  if (ref || aiConfidence != null) {
    return { image: null, method: "skipped-low-confidence", ref: ref || null, confidence: aiConfidence };
  }

  return { image: null, method: "blank", ref: null, confidence: null };
}

function logGeneratedImageFields(exercises) {
  const sampleItems = (Array.isArray(exercises) ? exercises : [])
    .flatMap((exercise) => exercise?.items || [])
    .slice(0, 5)
    .map((item) => ({
      title: questionTextFromItem(item),
      image: item?.image || item?.imageUrl || null,
      imageRef: item?.imageRef || null,
      imageRefConfidence:
        item?.imageRefConfidence ??
        item?.imageConfidence ??
        item?.imageMatchConfidence ??
        item?.confidence ??
        null,
    }));
  debugLogImageCrop({
    location: "material-images.js:logGeneratedImageFields",
    message: "generated item image fields",
    hypothesisId: "IMG-MATCH",
    data: { sampleItems },
  });
}

function stripImageRefMeta(item) {
  const next = { ...item };
  delete next.imageRef;
  delete next.imageRefConfidence;
  delete next.imageConfidence;
  delete next.imageMatchConfidence;
  return next;
}

function resolveExerciseImageRefs(exercises, imageAssets) {
  let attached = 0;
  let skippedLowConfidence = 0;
  let clearedCatalog = 0;
  let labelMatched = 0;

  const resolved = (Array.isArray(exercises) ? exercises : []).map((exercise) => ({
    ...exercise,
    items: (exercise.items || []).map((item) => {
      const match = resolveItemImageMatch(item, imageAssets);
      const rawConfidence =
        item?.imageRefConfidence ??
        item?.imageConfidence ??
        item?.imageMatchConfidence ??
        item?.confidence ??
        null;

      if (
        match.method === "attached" ||
        match.method === "ai-ref" ||
        match.method === "ai-ref-implicit" ||
        match.method === "ai-catalog-url" ||
        match.method === "url-label-match" ||
        match.method === "kept-ai-catalog-url"
      ) {
        attached += 1;
      } else if (match.method === "label-match") {
        attached += 1;
        labelMatched += 1;
      } else if (match.method === "cleared-catalog-url") {
        clearedCatalog += 1;
      } else if (match.method === "skipped-low-confidence") {
        skippedLowConfidence += 1;
      }

      if (match.ref || rawConfidence != null || item?.image || item?.imageUrl) {
        debugLogImageCrop({
          location: "material-images.js:resolveExerciseImageRefs:item",
          message: "image attach decision",
          hypothesisId: "IMG-MATCH",
          data: {
            title: questionTextFromItem(item),
            ref: match.ref,
            rawConfidence,
            parsedConfidence: match.confidence,
            method: match.method,
            hasCurrent: Boolean(item?.image || item?.imageUrl),
          },
        });
      }

      return { ...stripImageRefMeta(item), image: match.image };
    }),
  }));

  debugLogImageCrop({
    location: "material-images.js:resolveExerciseImageRefs",
    message: "resolved question images",
    hypothesisId: "IMG-MATCH",
    data: {
      attached,
      labelMatched,
      skippedLowConfidence,
      clearedCatalog,
      minConfidence: IMAGE_REF_MIN_CONFIDENCE,
      assetCount: Array.isArray(imageAssets) ? imageAssets.length : 0,
    },
  });

  return resolved;
}

function autoAssignMaterialImages(exercises) {
  return exercises;
}

module.exports = {
  MAX_ASSETS_PER_FILE,
  IMAGE_REF_MIN_CONFIDENCE,
  extractMaterialImageAssets,
  buildImageAssetCatalogBlock,
  assignImagesWithLlm,
  resolveExerciseImageRefs,
  resolveItemImageMatch,
  logGeneratedImageFields,
  autoAssignMaterialImages,
  normalizeAssetBuffer,
  parseImageRefConfidence,
};
