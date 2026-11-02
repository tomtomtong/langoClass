// Matching questions to material images and filling gaps with generated ones.
// Pure JS with injected model and image callbacks, so the Worker can run it;
// extraction from PDFs, slides and photos stays in material-images.js.

const IMAGE_REF_MIN_CONFIDENCE = 0.7;

// Debug tracing for image matching; kept as a hook so call sites stay put.
function debugLogImageCrop() {}
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

function buildAutoQuestionImagePrompt(questionText) {
  const text = String(questionText || "").trim();
  if (!text) return "";
  return `Educational illustration for a language learning quiz: ${text}. Friendly, clear, student-appropriate. No text or lettering in the image.`;
}

async function selectItemsForAutoImageGeneration(exercises, llmComplete, apiKey, model) {
  const entries = [];
  (Array.isArray(exercises) ? exercises : []).forEach((exercise, exIdx) => {
    if (exercise?.type === "video") return;
    (exercise.items || []).forEach((item, itemIdx) => {
      if (String(item?.image || item?.imageUrl || "").trim()) return;
      const text = questionTextFromItem(item);
      if (!text) return;
      entries.push({ key: `${exIdx}:${itemIdx}`, text, type: exercise.type || "mcquiz" });
    });
  });

  if (!entries.length || typeof llmComplete !== "function") return [];

  const messages = [
    {
      role: "system",
      content:
        "You decide which language-learning quiz questions would clearly benefit from a simple illustration. Return ONLY valid JSON. " +
        `Only include items where generateConfidence >= ${IMAGE_REF_MIN_CONFIDENCE}. ` +
        'Schema: {"generations":[{"key":"0:0","generateConfidence":0.85,"imagePrompt":"..."}]} ' +
        "imagePrompt must describe a student-friendly educational illustration with no text in the image. " +
        "Skip abstract grammar-only questions, pure vocabulary without a visual scene, or questions where an image would not help.",
    },
    {
      role: "user",
      content: `Questions:\n${JSON.stringify(entries, null, 2)}`,
    },
  ];

  try {
    const reply = await llmComplete(
      apiKey,
      model,
      messages,
      Math.min(2500, 320 + entries.length * 90)
    );
    const parsed = parseAssignmentJson(reply);
    const rows = Array.isArray(parsed?.generations) ? parsed.generations : [];
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));

    return rows
      .map((row) => {
        const key = String(row?.key || "").trim();
        const entry = byKey.get(key);
        if (!entry) return null;
        const confidence = parseImageRefConfidence({
          imageRefConfidence: row?.generateConfidence ?? row?.confidence,
        });
        if (confidence == null || confidence < IMAGE_REF_MIN_CONFIDENCE) return null;
        const prompt =
          String(row?.imagePrompt || "").trim() || buildAutoQuestionImagePrompt(entry.text);
        if (!prompt) return null;
        return { key, prompt, confidence };
      })
      .filter(Boolean);
  } catch (err) {
    debugLogImageCrop({
      location: "material-images.js:selectItemsForAutoImageGeneration",
      message: "auto image selection failed",
      hypothesisId: "IMG-AUTO-GEN",
      data: { error: err.message, entryCount: entries.length },
    });
    return [];
  }
}

async function autoGenerateMissingQuestionImages(exercises, options = {}) {
  const {
    llmComplete,
    apiKey,
    model,
    routerBaseUrl,
    generateImage,
    saveGeneratedImage,
    maxGenerations = 12,
  } = options;

  const next = (Array.isArray(exercises) ? exercises : []).map((exercise) => ({
    ...exercise,
    items: [...(exercise.items || [])],
  }));

  if (
    !String(routerBaseUrl || "").trim() ||
    typeof generateImage !== "function" ||
    typeof saveGeneratedImage !== "function"
  ) {
    return { exercises: next, stats: { generated: 0, failed: 0, candidates: 0, skipped: "router-not-configured" } };
  }

  const candidates = await selectItemsForAutoImageGeneration(next, llmComplete, apiKey, model);
  let generated = 0;
  let failed = 0;

  for (const candidate of candidates.slice(0, Math.max(0, Number(maxGenerations) || 12))) {
    const parts = String(candidate.key || "").split(":");
    const exIdx = Number(parts[0]);
    const itemIdx = Number(parts[1]);
    const item = next[exIdx]?.items?.[itemIdx];
    if (!item || String(item?.image || item?.imageUrl || "").trim()) continue;

    try {
      const { image } = await generateImage(routerBaseUrl, candidate.prompt);
      const url = saveGeneratedImage(image);
      item.image = url;
      generated += 1;
    } catch (err) {
      failed += 1;
      debugLogImageCrop({
        location: "material-images.js:autoGenerateMissingQuestionImages",
        message: "router image generation failed",
        hypothesisId: "IMG-AUTO-GEN",
        data: { key: candidate.key, error: err.message },
      });
    }
  }

  debugLogImageCrop({
    location: "material-images.js:autoGenerateMissingQuestionImages",
    message: "auto image generation complete",
    hypothesisId: "IMG-AUTO-GEN",
    data: { generated, failed, candidates: candidates.length },
  });

  return { exercises: next, stats: { generated, failed, candidates: candidates.length } };
}

module.exports = {
  IMAGE_REF_MIN_CONFIDENCE,
  buildImageAssetCatalogBlock,
  assignImagesWithLlm,
  resolveExerciseImageRefs,
  resolveItemImageMatch,
  logGeneratedImageFields,
  autoAssignMaterialImages,
  autoGenerateMissingQuestionImages,
  buildAutoQuestionImagePrompt,
  parseImageRefConfidence,
};
