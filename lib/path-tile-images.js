const sharp = require("sharp");

const CHROMA_KEY = { r: 255, g: 0, b: 255 };
const CHROMA_THRESHOLD = 52;
const BLACK_THRESHOLD = 42;

function summarizeSectionContent(section) {
  const exercises = Array.isArray(section?.exercises) ? section.exercises : [];
  const snippets = [];

  for (const exercise of exercises) {
    const type = String(exercise?.type || "mcquiz").trim();
    const exerciseTitle = String(exercise?.title || "").trim();
    if (exerciseTitle && !/^(exercise|untitled)$/i.test(exerciseTitle)) {
      snippets.push(exerciseTitle);
    }

    for (const item of exercise?.items || []) {
      if (type === "buzzin") {
        const topic = String(item?.topic || "").trim();
        if (topic) snippets.push(topic);
        continue;
      }

      if (type === "video") {
        const script = String(item?.script || item?.title || item?.description || "").trim();
        if (script) snippets.push(script.slice(0, 160));
        continue;
      }

      const question = String(item?.title || item?.question || item?.topic || "").trim();
      if (question) snippets.push(question);

      const correct = (item?.options || []).find((option) => option?.isCorrect)?.text;
      if (correct) snippets.push(String(correct).trim());
    }
  }

  const unique = [...new Set(snippets.map((line) => line.trim()).filter(Boolean))];
  return unique.slice(0, 14).join("; ");
}

function buildPathTileImagePrompt(sectionTitle, options = {}) {
  const title = String(sectionTitle || "").trim() || "Language lesson";
  const courseName = String(options.courseName || "").trim();
  const sectionContent = String(options.sectionContent || options.contentSummary || "").trim();
  const courseLine = courseName ? ` Course theme: "${courseName}".` : "";
  const contentLine = sectionContent
    ? ` Lesson content to visualize: ${sectionContent}.`
    : "";

  return (
    `3D isometric floating island path tile for a language-learning app journey map. Lesson theme: "${title}".${courseLine}${contentLine} ` +
    `Circular grassy diorama island with a rocky underside, vibrant polished 3D render, premium mobile game art style. ` +
    `Arrange recognizable cultural landmarks, flags, objects, and symbols that match the lesson theme and content across the island. ` +
    `Do NOT include any human characters, mascots, or guide figures. ` +
    `Rich saturated colors, playful educational diorama, contrasting cultures or topics when relevant. ` +
    `Square 1:1 composition, clean studio lighting. No text, no letters, no numbers, no color codes, no hex values, no labels, no watermarks, no UI frames. ` +
    `Render on a solid flat magenta chroma-key background only — no gradients, no sky, no clouds, no sun, no floor shadow on the backdrop.`
  );
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

function rgbToHue(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 1) return 0;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

/** Pixels that should become transparent (chroma + common AI backdrop colors). */
function isPathTileBackdrop(r, g, b) {
  const hue = rgbToHue(r, g, b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  if (colorDistance(r, g, b, CHROMA_KEY.r, CHROMA_KEY.g, CHROMA_KEY.b) <= CHROMA_THRESHOLD * 3) {
    return true;
  }

  const magentaHue = hue >= 275 && hue <= 340;
  const magentaBias = (r + b) / 2 - g;
  if (magentaHue && saturation > 0.18 && max > 60 && magentaBias > 22 && g < 185) {
    return true;
  }

  if (r > 175 && b > 130 && g < 130 && r > g + 35) return true;

  if (b > 130 && g > 95 && r < 200 && b >= g - 8 && g > r + 15 && b > r + 25) {
    return true;
  }

  const lum = (r + g + b) / 3;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (lum > 228 && spread < 32) return true;
  if (b > 198 && g > 188 && r > 165 && b >= g - 6 && spread < 55) return true;
  if (r > 238 && g > 232 && b > 205 && spread < 45) return true;

  return false;
}

function matchesTargetColor(data, index, target, threshold) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  if (target === CHROMA_KEY || (target.r === 255 && target.g === 0 && target.b === 255)) {
    return isPathTileBackdrop(r, g, b);
  }
  return colorDistance(r, g, b, target.r, target.g, target.b) <= threshold * 3;
}

function desaturateBackdropFringe(data) {
  const next = Buffer.from(data);
  for (let i = 0; i < next.length; i += 4) {
    if (next[i + 3] < 12) continue;
    const r = next[i];
    const g = next[i + 1];
    const b = next[i + 2];
    if (!isPathTileBackdrop(r, g, b)) continue;
    const spill = Math.max(0, Math.round((r + b) / 2 - g));
    next[i + 3] = Math.max(0, next[i + 3] - Math.min(220, 80 + spill));
  }
  return next;
}

function opaquePixelRatio(data) {
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 12) opaque += 1;
  }
  return opaque / (data.length / 4);
}

async function removeEdgeConnectedBackground(buffer, target, threshold) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const visited = new Uint8Array(width * height);
  const queue = [];

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    queue.push(x, y);
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  while (queue.length) {
    const y = queue.pop();
    const x = queue.pop();
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) continue;

    const dataIndex = pixelIndex * 4;
    if (!matchesTargetColor(data, dataIndex, target, threshold)) continue;

    visited[pixelIndex] = 1;
    data[dataIndex + 3] = 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
    push(x + 1, y + 1);
    push(x - 1, y - 1);
    push(x + 1, y - 1);
    push(x - 1, y + 1);
  }

  let keyed = desaturateBackdropFringe(data);

  const erodeFringe = (src) => {
    const out = Buffer.from(src);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dataIndex = (y * width + x) * 4;
        if (src[dataIndex + 3] < 12) continue;
        if (!isPathTileBackdrop(src[dataIndex], src[dataIndex + 1], src[dataIndex + 2])) continue;
        let nearClear = false;
        for (let dy = -1; dy <= 1 && !nearClear; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (src[(ny * width + nx) * 4 + 3] < 12) nearClear = true;
          }
        }
        if (nearClear) out[dataIndex + 3] = 0;
      }
    }
    return out;
  };

  keyed = erodeFringe(keyed);
  keyed = erodeFringe(keyed);

  return sharp(keyed, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function processGeneratedPathTile(buffer) {
  let islandBuffer = await removeEdgeConnectedBackground(buffer, CHROMA_KEY, CHROMA_THRESHOLD);
  let { data } = await sharp(islandBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (opaquePixelRatio(data) < 0.04) {
    islandBuffer = await removeEdgeConnectedBackground(buffer, { r: 0, g: 0, b: 0 }, BLACK_THRESHOLD);
    ({ data } = await sharp(islandBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }

  if (opaquePixelRatio(data) < 0.04) {
    islandBuffer = await sharp(buffer).ensureAlpha().png().toBuffer();
  }

  return islandBuffer;
}

async function autoGenerateMissingSectionPathTiles(sections, options = {}) {
  const {
    routerBaseUrl,
    generateImage,
    saveGeneratedImage,
    maxGenerations = 8,
    courseName = "",
  } = options;

  const next = (Array.isArray(sections) ? sections : []).map((section) => ({ ...section }));

  if (
    !String(routerBaseUrl || "").trim() ||
    typeof generateImage !== "function" ||
    typeof saveGeneratedImage !== "function"
  ) {
    return { sections: next, stats: { generated: 0, failed: 0, candidates: 0, skipped: "router-not-configured" } };
  }

  const candidates = next
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => !String(section?.banner || "").trim());

  let generated = 0;
  let failed = 0;

  for (const candidate of candidates.slice(0, Math.max(0, Number(maxGenerations) || 8))) {
    const { section, index } = candidate;
    const title = String(section?.title || "").trim() || `Section ${index + 1}`;
    const sectionContent = summarizeSectionContent(section);
    const prompt = buildPathTileImagePrompt(title, { courseName, sectionContent });

    try {
      const { image } = await generateImage(routerBaseUrl, prompt);
      const url = await saveGeneratedImage(image, { sectionIndex: index, sectionId: section?.id });
      next[index].banner = url;
      generated += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    sections: next,
    stats: { generated, failed, candidates: candidates.length },
  };
}

module.exports = {
  summarizeSectionContent,
  buildPathTileImagePrompt,
  processGeneratedPathTile,
  autoGenerateMissingSectionPathTiles,
};
