const {
  parseJsonFromLlm,
  scopeMaterialWithInstructions,
  languageName,
  languageOutputRequirement,
} = require("./exercise-generator");

const MAX_SECTIONS = 20;
const MAX_PLAN_MATERIAL_CHARS = 40000;
const MAX_EXCERPT_CHARS = 12000;
const THIN_SECTION_CHARS = 250;
const TYPE_KEYS = ["mcquiz", "fastmcquiz", "buzzin", "video"];

function clampCount(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function lockTypes(typesInput) {
  const types = {};
  if (!typesInput || typeof typesInput !== "object" || Array.isArray(typesInput)) return types;
  for (const key of TYPE_KEYS) {
    const n = Number(typesInput[key]);
    if (Number.isFinite(n) && n > 0) types[key] = clampCount(n);
  }
  return types;
}

function lockDifficulty(value) {
  const level = String(value || "medium").toLowerCase();
  if (level === "easy" || level === "hard") return level;
  return "medium";
}

function formatLabel(types, difficulty) {
  const parts = TYPE_KEYS.filter((key) => types[key] > 0).map((key) => {
    const names = {
      mcquiz: "MC Quiz",
      fastmcquiz: "Lightning round",
      buzzin: "Buzz in Question",
      video: "Video",
    };
    return `${types[key]} ${names[key]}`;
  });
  if (difficulty) parts.push(difficulty[0].toUpperCase() + difficulty.slice(1));
  return parts.join(" · ") || "No types selected";
}

function warnForExcerpt(excerpt) {
  const length = String(excerpt || "").trim().length;
  if (!length) return "No material in this section.";
  if (length < THIN_SECTION_CHARS) return "This section is short — generated questions may be generic.";
  if (length > MAX_EXCERPT_CHARS) return "Material is long and will be truncated for generation.";
  return "";
}

function sliceExcerpt(text) {
  const normalized = String(text || "").trim();
  if (normalized.length <= MAX_EXCERPT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_EXCERPT_CHARS).trim()}\n\n[…truncated for generation]`;
}

function splitMaterialByHeadings(markdown) {
  const text = String(markdown || "").replace(/\r/g, "").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const headingRe = /^(#{1,3})\s+(.+?)\s*$/;
  const unitRe =
    /^(?:lesson|unit|chapter|module|week|part|section|第\s*\d+\s*[课課單元单元章]|第.+[课課單元单元章])\b.+$/i;

  const chunks = [];
  let current = { title: "", heading: "", lines: [] };

  const push = () => {
    const material = current.lines.join("\n").trim();
    if (!material && !current.title) return;
    chunks.push({
      title: (current.title || "Lesson").slice(0, 80),
      heading: current.heading || "",
      material,
    });
  };

  for (const line of lines) {
    const heading = line.match(headingRe);
    const unit = !heading && unitRe.test(line.trim()) ? line.trim() : "";
    if (heading || unit) {
      const nextTitle = heading ? heading[2].trim() : unit.replace(/[:：]\s*$/, "").trim();
      if (current.lines.length || current.title) push();
      current = {
        title: nextTitle.slice(0, 80) || "Lesson",
        heading: (heading ? heading[0] : unit).trim(),
        lines: heading ? [] : [line],
      };
      continue;
    }
    current.lines.push(line);
  }
  push();

  const nonempty = chunks.filter((chunk) => String(chunk.material || "").trim());
  if (nonempty.length) return nonempty.slice(0, MAX_SECTIONS);
  return [{ title: "Lesson", heading: "", material: text }];
}

function buildLockedSection(partial, format, index) {
  const excerpt = sliceExcerpt(partial.material || partial.materialExcerpt || "");
  const warning = warnForExcerpt(excerpt);
  return {
    key: String(partial.key ?? index),
    title: String(partial.title || `Section ${index + 1}`).trim().slice(0, 80) || `Section ${index + 1}`,
    summary: String(partial.summary || "").trim().slice(0, 240),
    materialExcerpt: excerpt,
    types: { ...format.types },
    difficulty: format.difficulty,
    included: partial.included !== false && !!excerpt,
    warning,
  };
}

function heuristicPlan(material, format) {
  const chunks = splitMaterialByHeadings(material);
  return {
    formatSource: Object.keys(format.types || {}).length ? "outline" : "none",
    appliedTemplate: format.template,
    appliedTypes: { ...format.types },
    appliedDifficulty: format.difficulty,
    formatLabel: formatLabel(format.types, format.difficulty),
    courseTitle: chunks[0]?.title || "Course",
    sourceLength: String(material || "").length,
    truncated: String(material || "").length > MAX_PLAN_MATERIAL_CHARS,
    planner: "headings",
    sections: chunks.map((chunk, index) => buildLockedSection(chunk, format, index)),
  };
}

function applyLockedFormat(plan, format) {
  const sections = Array.isArray(plan?.sections) ? plan.sections : [];
  return {
    formatSource: Object.keys(format.types || {}).length ? "outline" : "none",
    appliedTemplate: format.template,
    appliedTypes: { ...format.types },
    appliedDifficulty: format.difficulty,
    formatLabel: formatLabel(format.types, format.difficulty),
    courseTitle: String(plan?.courseTitle || "").trim().slice(0, 120) || "Course",
    sourceLength: Number(plan?.sourceLength) || 0,
    truncated: Boolean(plan?.truncated),
    planner: plan?.planner || "headings",
    notes: String(plan?.notes || "").trim().slice(0, 400),
    sections: sections.slice(0, MAX_SECTIONS).map((section, index) =>
      buildLockedSection(section, format, index)
    ),
  };
}

function validateCoursePlan(plan, format) {
  const locked = applyLockedFormat(plan || {}, format);
  const included = locked.sections.filter((section) => section.included);
  if (!included.length) {
    throw new Error("The course plan has no sections with material.");
  }
  return locked;
}

function formatTeacherInstructions(instructions) {
  const text = String(instructions || "").trim();
  if (!text) return "";
  return (
    `TEACHER INSTRUCTIONS — MUST FOLLOW (scope filter):\n${text}\n\n` +
    "CRITICAL: Only include sections and material that match these instructions. " +
    "Omit all other tenses, topics, or sections from the document.\n\n"
  );
}

function buildCoursePlanPrompt({ material, format, candidates, langCode, instructions }) {
  const candidateList = candidates
    .map(
      (chunk, index) =>
        `[${index}] ${chunk.title}\n${String(chunk.material || "").slice(0, 420)}`
    )
    .join("\n\n");

  const instructionBlock = formatTeacherInstructions(instructions);

  return [
    {
      role: "system",
      content:
        "You split language-course source material into classroom sections. " +
        (instructionBlock
          ? "Teacher instructions define mandatory scope; never include out-of-scope sections. "
          : "") +
        (Object.keys(format?.types || {}).length
          ? "If a format is provided, copy it onto every section. Do not invent types. "
          : "Do not choose exercise types. Titles and summaries only. ") +
        "Return ONLY valid JSON (no markdown fences, no commentary).",
    },
    {
      role: "user",
      content:
        `Learner language/context: ${langCode || "en"} (${languageName(langCode)}).\n` +
        `${languageOutputRequirement(langCode)}\n` +
        `Write every courseTitle, section title, and summary in ${languageName(langCode)}.\n` +
        (Object.keys(format?.types || {}).length
          ? `OPTIONAL FORMAT: ${JSON.stringify(format.types)} at ${format.difficulty} difficulty. Template: ${format.template}.\n\n`
          : "No play format yet — split the document only.\n\n") +
        "Return JSON: " +
        '{"courseTitle":"string","notes":"string","sections":[{"indexes":[0],"title":"string","summary":"one sentence"}]}.\n' +
        "Rules:\n" +
        "- indexes must refer to the candidate sections below.\n" +
        "- You may merge consecutive candidates with multiple indexes.\n" +
        "- You may omit weak candidates.\n" +
        `- At most ${MAX_SECTIONS} sections.\n` +
        "- Do not invent source text. Titles/summaries only.\n\n" +
        instructionBlock +
        `CANDIDATE SECTIONS:\n${candidateList}\n\n` +
        `FULL MATERIAL (may be truncated — use only parts allowed by instructions above):\n${String(material || "").slice(0, 12000)}`,
    },
  ];
}

function mergeCandidateMaterial(candidates, indexes) {
  const parts = [];
  for (const raw of indexes || []) {
    const index = Number(raw);
    if (!Number.isInteger(index) || !candidates[index]) continue;
    parts.push(String(candidates[index].material || "").trim());
  }
  return parts.filter(Boolean).join("\n\n");
}

function planFromLlmPayload(parsed, candidates, format) {
  const rows = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const used = new Set();
  const sections = [];

  for (const row of rows) {
    const indexes = (Array.isArray(row?.indexes) ? row.indexes : [row?.index])
      .map((value) => Number(value))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < candidates.length && !used.has(index));
    if (!indexes.length) continue;
    indexes.forEach((index) => used.add(index));
    const first = candidates[indexes[0]];
    sections.push({
      title: String(row?.title || first?.title || "").trim(),
      summary: String(row?.summary || "").trim(),
      material: mergeCandidateMaterial(candidates, indexes),
    });
    if (sections.length >= MAX_SECTIONS) break;
  }

  if (!sections.length) return null;
  return applyLockedFormat(
    {
      courseTitle: parsed?.courseTitle,
      notes: parsed?.notes,
      planner: "llm",
      sections,
    },
    format
  );
}

async function analyzeCourseMaterial(options, llmComplete) {
  const material = String(options.material || "").trim();
  if (!material) throw new Error("Material text is required.");

  const types = lockTypes(options.types);
  const format = {
    template: String(options.template || "custom").trim() || "custom",
    types,
    difficulty: lockDifficulty(options.difficulty),
  };

  const model = String(options.model || "").trim();
  const instructions = String(options.instructions || "").trim();
  let workingMaterial = material;

  if (instructions && typeof llmComplete === "function") {
    workingMaterial = await scopeMaterialWithInstructions(
      material,
      instructions,
      llmComplete,
      options.apiKey,
      model
    );
  }

  const clipped =
    workingMaterial.length > MAX_PLAN_MATERIAL_CHARS
      ? `${workingMaterial.slice(0, MAX_PLAN_MATERIAL_CHARS).trim()}\n\n[…truncated for planning]`
      : workingMaterial;

  const fallback = heuristicPlan(clipped, format);
  fallback.sourceLength = material.length;
  fallback.truncated = material.length > MAX_PLAN_MATERIAL_CHARS;

  if (typeof llmComplete !== "function") return fallback;

  try {
    const messages = buildCoursePlanPrompt({
      material: clipped,
      format,
      candidates: splitMaterialByHeadings(clipped),
      langCode: options.langCode,
      instructions: options.instructions,
    });
    const reply = await llmComplete(options.apiKey, options.model, messages, 1800);
    const parsed = parseJsonFromLlm(reply);
    const planned = planFromLlmPayload(parsed, splitMaterialByHeadings(clipped), format);
    if (planned?.sections?.length) {
      planned.sourceLength = material.length;
      planned.truncated = material.length > MAX_PLAN_MATERIAL_CHARS;
      return planned;
    }
  } catch {
    /* keep heading split */
  }

  return fallback;
}

function jobsFromPlan(plan, format) {
  const locked = validateCoursePlan(plan, format);
  return locked.sections
    .filter((section) => section.included)
    .map((section, index) => ({
      key: section.key || String(index),
      sectionTitle: section.title,
      material: section.materialExcerpt,
      types: { ...locked.appliedTypes },
      difficulty: locked.appliedDifficulty,
    }));
}

module.exports = {
  MAX_SECTIONS,
  MAX_PLAN_MATERIAL_CHARS,
  MAX_EXCERPT_CHARS,
  TYPE_KEYS,
  lockTypes,
  lockDifficulty,
  formatLabel,
  splitMaterialByHeadings,
  heuristicPlan,
  applyLockedFormat,
  validateCoursePlan,
  analyzeCourseMaterial,
  jobsFromPlan,
};
