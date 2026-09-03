const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const UNCLE_TOMMY_REF_PATH = path.join(__dirname, "..", "public", "assets", "cms", "uncle-tommy-path-tile-ref.jpg");
const CHROMA_KEY = { r: 255, g: 0, b: 255 };
const CHROMA_THRESHOLD = 52;
const BLACK_THRESHOLD = 42;

let uncleTommyOverlayPromise = null;

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
    `Do NOT include any human characters or mascots in the generated scene; leave the front-bottom foreground clear for a guide character. ` +
    `Rich saturated colors, playful educational diorama, contrasting cultures or topics when relevant. ` +
    `Square 1:1 composition, clean studio lighting, no text, no letters, no watermarks, no UI frames. ` +
    `Render on a solid flat magenta chroma-key background (#FF00FF) only — no gradients, no sky, no floor shadow on the backdrop.`
  );
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

function matchesTargetColor(data, index, target, threshold) {
  return (
    colorDistance(data[index], data[index + 1], data[index + 2], target.r, target.g, target.b) <=
    threshold * 3
  );
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
  }

  return sharp(data, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function prepareUncleTommyOverlay() {
  if (uncleTommyOverlayPromise) return uncleTommyOverlayPromise;

  uncleTommyOverlayPromise = (async () => {
    if (!fs.existsSync(UNCLE_TOMMY_REF_PATH)) return null;
    const raw = await fs.promises.readFile(UNCLE_TOMMY_REF_PATH);
    return removeEdgeConnectedBackground(raw, { r: 0, g: 0, b: 0 }, BLACK_THRESHOLD);
  })();

  return uncleTommyOverlayPromise;
}

async function compositeUncleTommyOnIsland(islandBuffer) {
  const tommyBuffer = await prepareUncleTommyOverlay();
  if (!tommyBuffer) return islandBuffer;

  const islandMeta = await sharp(islandBuffer).metadata();
  const width = islandMeta.width || 1024;
  const height = islandMeta.height || 1024;
  const tommyWidth = Math.round(width * 0.36);
  const tommyResized = await sharp(tommyBuffer)
    .resize({ width: tommyWidth, fit: "inside" })
    .png()
    .toBuffer();
  const tommyMeta = await sharp(tommyResized).metadata();
  const tommyHeight = tommyMeta.height || tommyWidth;
  const tommyRenderedWidth = tommyMeta.width || tommyWidth;
  const left = Math.max(0, Math.round((width - tommyRenderedWidth) / 2));
  const top = Math.max(0, Math.round(height - tommyHeight * 0.94));

  return sharp(islandBuffer)
    .composite([{ input: tommyResized, left, top }])
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

  return compositeUncleTommyOnIsland(islandBuffer);
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
  UNCLE_TOMMY_REF_PATH,
};
