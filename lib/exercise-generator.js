const DEFAULT_GENERATE_MODEL = "x-ai/grok-4.3";

const TYPE_LABELS = {
  mcquiz: "MC Quiz",
  fastmcquiz: "Fast MC Quiz",
  buzzin: "Buzz In",
};

const TYPE_TITLES = {
  mcquiz: "Quiz",
  fastmcquiz: "Fast quiz",
  buzzin: "Buzz In",
};

function normalizeTypeCounts(typesInput, countPerType = 3) {
  const counts = {};
  if (typesInput && typeof typesInput === "object" && !Array.isArray(typesInput)) {
    for (const [type, count] of Object.entries(typesInput)) {
      if (!TYPE_LABELS[type]) continue;
      const n = Math.max(0, Math.min(20, Number(count) || 0));
      if (n > 0) counts[type] = n;
    }
    return counts;
  }

  const list = Array.isArray(typesInput) ? typesInput : ["mcquiz"];
  const perType = Math.max(1, Math.min(20, Number(countPerType) || 3));
  for (const type of list) {
    if (TYPE_LABELS[type]) counts[type] = perType;
  }
  return counts;
}

function languageName(code) {
  const map = {
    en: "English",
    zh: "Chinese",
    yue: "Cantonese",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
    fr: "French",
  };
  return map[String(code || "en").toLowerCase()] || String(code || "English");
}

function difficultyGuidance(level) {
  const normalized = String(level || "medium").toLowerCase();
  if (normalized === "easy") {
    return "Use simple vocabulary and direct comprehension questions suitable for beginners.";
  }
  if (normalized === "hard") {
    return "Use inference, nuance, and paraphrasing. Avoid copying phrases verbatim from the material.";
  }
  return "Use classroom-appropriate difficulty for intermediate learners.";
}

function buildGenerationPrompt({ material, langCode, difficulty, typeCounts }) {
  const targetLanguage = languageName(langCode);
  const requests = Object.entries(typeCounts).map(([type, count]) => {
    if (type === "buzzin") {
      return `- ${count} buzz-in speaking prompts (type "buzzin"): open-ended topics students answer aloud. Include "correctAnswer" as a short rubric for acceptable answers.`;
    }
    if (type === "fastmcquiz") {
      return `- ${count} fast multiple-choice questions (type "fastmcquiz"): 3-4 options, one correct, timeLimit 8-12 seconds, concise stems.`;
    }
    return `- ${count} multiple-choice questions (type "mcquiz"): 4 options, one correct, timeLimit 12-20 seconds.`;
  });

  return [
    {
      role: "system",
      content:
        "You generate language-learning classroom exercises from source material. " +
        "Return ONLY valid JSON (no markdown fences, no commentary). " +
        'Schema: {"exercises":[{"type":"mcquiz|fastmcquiz|buzzin","title":"string","subTitle":"string","items":[...]}]}. ' +
        "For mcquiz/fastmcquiz items: {title, options:[{text,isCorrect}], timeLimit, image:null}. " +
        "For buzzin items: {topic, correctAnswer}. " +
        "Every mc option set must have exactly one isCorrect:true. " +
        "Questions must be faithful to the material but not copy long passages verbatim.",
    },
    {
      role: "user",
      content:
        `Target learner language/context: ${targetLanguage}.\n` +
        `${difficultyGuidance(difficulty)}\n\n` +
        `Generate:\n${requests.join("\n")}\n\n` +
        `Use these subTitle values: mcquiz → "MC Quiz", fastmcquiz → "Fast MC Quiz", buzzin → "Buzz In".\n` +
        `Group items of the same type into one exercise object when practical.\n\n` +
        `SOURCE MATERIAL (markdown):\n${material}`,
    },
  ];
}

function parseJsonFromLlm(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Model returned empty output.");

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model output was not valid JSON.");
  }
}

function normalizeMcItem(item, { fast = false } = {}) {
  const title = String(item?.title || "").trim();
  if (!title) return null;

  const options = (Array.isArray(item?.options) ? item.options : [])
    .map((opt) => ({
      text: String(opt?.text || "").trim(),
      isCorrect: Boolean(opt?.isCorrect),
    }))
    .filter((opt) => opt.text)
    .slice(0, 6);

  if (options.length < 2) return null;

  const correctCount = options.filter((opt) => opt.isCorrect).length;
  if (correctCount !== 1) {
    options.forEach((opt, index) => {
      opt.isCorrect = index === 0;
    });
  }

  const timeLimitRaw = Number(item?.timeLimit);
  const timeLimit = Number.isFinite(timeLimitRaw)
    ? Math.max(5, Math.min(60, Math.round(timeLimitRaw)))
    : fast
      ? 10
      : 15;

  return {
    title,
    options,
    timeLimit,
    image: item?.image ? String(item.image) : null,
  };
}

function normalizeBuzzinItem(item) {
  const topic = String(item?.topic || "").trim();
  if (!topic) return null;
  const correctAnswer = String(item?.correctAnswer || item?.rubric || "").trim();
  return {
    topic,
    correctAnswer:
      correctAnswer ||
      "Any clear, relevant spoken answer that uses the lesson vocabulary is acceptable.",
  };
}

function normalizeGeneratedExercise(raw) {
  const type = String(raw?.type || "").trim();
  if (!TYPE_LABELS[type]) return null;

  const items =
    type === "buzzin"
      ? (Array.isArray(raw?.items) ? raw.items : [])
          .map(normalizeBuzzinItem)
          .filter(Boolean)
      : (Array.isArray(raw?.items) ? raw.items : [])
          .map((item) => normalizeMcItem(item, { fast: type === "fastmcquiz" }))
          .filter(Boolean);

  if (!items.length) return null;

  return {
    type,
    title: String(raw?.title || TYPE_TITLES[type]).trim().slice(0, 120) || TYPE_TITLES[type],
    subTitle: String(raw?.subTitle || TYPE_LABELS[type]).trim().slice(0, 120) || TYPE_LABELS[type],
    items,
  };
}

function validateGeneratedExercises(payload, typeCounts) {
  const exercises = (Array.isArray(payload?.exercises) ? payload.exercises : [])
    .map(normalizeGeneratedExercise)
    .filter(Boolean);

  const itemCounts = { mcquiz: 0, fastmcquiz: 0, buzzin: 0 };
  for (const exercise of exercises) {
    itemCounts[exercise.type] += exercise.items.length;
  }

  const missing = Object.entries(typeCounts)
    .filter(([type, needed]) => (itemCounts[type] || 0) < needed)
    .map(([type, needed]) => `${type}: got ${itemCounts[type] || 0}, need ${needed}`);

  return {
    exercises,
    itemCounts,
    missing,
    ok: missing.length === 0,
  };
}

async function generateExercisesFromMaterial(options, llmComplete) {
  if (typeof llmComplete !== "function") {
    throw new Error("LLM complete function is required.");
  }

  const material = String(options.material || "").trim();
  if (!material) throw new Error("Material text is required.");

  const typeCounts = normalizeTypeCounts(options.types, options.countPerType);
  if (!Object.keys(typeCounts).length) {
    throw new Error("Select at least one exercise type.");
  }

  const messages = buildGenerationPrompt({
    material,
    langCode: options.langCode,
    difficulty: options.difficulty,
    typeCounts,
  });

  const totalItems = Object.values(typeCounts).reduce((sum, n) => sum + n, 0);
  const maxTokens = Math.min(8000, 400 + totalItems * 180);

  const model = String(options.model || DEFAULT_GENERATE_MODEL).trim() || DEFAULT_GENERATE_MODEL;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reply = await llmComplete(options.apiKey, model, messages, maxTokens);
      const parsed = parseJsonFromLlm(reply);
      const validated = validateGeneratedExercises(parsed, typeCounts);
      if (validated.exercises.length && (validated.ok || attempt === 1)) {
        return {
          exercises: validated.exercises,
          model,
          stats: {
            requested: totalItems,
            generated: Object.values(validated.itemCounts).reduce((sum, n) => sum + n, 0),
            itemCounts: validated.itemCounts,
            partial: !validated.ok,
            missing: validated.missing,
          },
        };
      }
      lastError = new Error(
        validated.missing.length
          ? `Incomplete generation: ${validated.missing.join("; ")}`
          : "No valid exercises were generated."
      );
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Exercise generation failed.");
}

function normalizeImportedExercises(exercises) {
  return (Array.isArray(exercises) ? exercises : [])
    .map(normalizeGeneratedExercise)
    .filter(Boolean);
}

module.exports = {
  DEFAULT_GENERATE_MODEL,
  TYPE_LABELS,
  normalizeTypeCounts,
  buildGenerationPrompt,
  parseJsonFromLlm,
  validateGeneratedExercises,
  normalizeImportedExercises,
  generateExercisesFromMaterial,
};
