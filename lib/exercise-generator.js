const fs = require("fs");
const path = require("path");
const materialImages = require("./material-images");

const DEFAULT_GENERATE_MODEL = "x-ai/grok-4.3";
const DEBUG_LOG_PATH = path.join(__dirname, "..", ".cursor", "debug-365eeb.log");

function debugGenLog(location, message, data, hypothesisId, runId = "gen-lang") {
  try {
    fs.appendFileSync(
      DEBUG_LOG_PATH,
      `${JSON.stringify({
        sessionId: "365eeb",
        timestamp: Date.now(),
        location,
        message,
        data,
        hypothesisId,
        runId,
      })}\n`
    );
  } catch {
    /* ignore debug log failures */
  }
}

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

const {
  GROK_TTS_SPEAK_LANGUAGES,
  LEGACY_SPEAK_LANG_LABELS,
} = require("./cms-speak-languages");

function languageName(code) {
  const lower = String(code || "en").toLowerCase();
  const match = GROK_TTS_SPEAK_LANGUAGES.find((entry) => entry.code.toLowerCase() === lower);
  if (match) return match.label;
  if (LEGACY_SPEAK_LANG_LABELS[lower]) return LEGACY_SPEAK_LANG_LABELS[lower];
  return String(code || "English");
}

const SIMPLIFIED_CHINESE_CHARS =
  /[这国们时说会个还问图书长开关听语华现从让给进远东电画产业页风龙马鸟鱼见车无云专两为乐习买卖学对头来发广东门时]/;

function usesSimplifiedChinese(text) {
  return SIMPLIFIED_CHINESE_CHARS.test(String(text || ""));
}

function languageScriptHint(code) {
  const normalized = String(code || "en").toLowerCase();
  if (normalized === "yue") {
    return (
      "Use Traditional Chinese characters (繁體中文) with natural Hong Kong Cantonese wording and grammar (廣東話). " +
      "Never use Simplified Chinese (简体中文). " +
      'Example stem: "嗰啲街仔遊戲主要係邊個年代？" Example option: "1960年代".'
    );
  }
  if (normalized === "zh") {
    return (
      "Use Traditional Chinese (繁體中文) in standard written form. " +
      "Never use Simplified Chinese characters (简体中文). " +
      'Example stem: "這些街頭遊戲主要來自哪個年代？" Example option: "20世紀60年代".'
    );
  }
  if (normalized === "ja") {
    return "Use Japanese (日本語) for every stem and option.";
  }
  if (normalized === "ko") {
    return "Use Korean (한국어) for every stem and option.";
  }
  return "";
}

function languageOutputRequirement(code) {
  const targetLanguage = languageName(code);
  const scriptHint = languageScriptHint(code);
  return (
    `OUTPUT LANGUAGE (mandatory): Write ALL generated text in ${targetLanguage}. ` +
    "That includes every question stem, every multiple-choice option, every buzz-in topic, and every correct-answer rubric. " +
    "Even if the SOURCE MATERIAL is in another language (for example English), translate/adapt into the target language. " +
    "Do not copy English phrasing from the material. " +
    "Do not write questions or answers in any other language unless the source material requires quoting a fixed proper noun." +
    (scriptHint ? ` ${scriptHint}` : "")
  );
}

function countScriptChars(text) {
  const sample = String(text || "");
  return {
    cjk: (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length,
    kana: (sample.match(/[\u3040-\u30ff]/g) || []).length,
    hangul: (sample.match(/[\uac00-\d7af]/g) || []).length,
    latin: (sample.match(/[A-Za-z]/g) || []).length,
  };
}

function textMatchesTargetLanguage(text, langCode) {
  const code = String(langCode || "en").toLowerCase();
  const sample = String(text || "").trim();
  if (!sample || code === "en" || code === "es" || code === "fr") return true;

  const { cjk, kana, hangul, latin } = countScriptChars(sample);

  if (code === "zh" || code === "yue") {
    if (latin >= 4 && latin > cjk) return false;
    if (cjk === 0 && latin > 0) return false;
    if (usesSimplifiedChinese(sample)) return false;
    return true;
  }
  if (code === "ja") {
    if (latin >= 4 && cjk + kana === 0) return false;
    if (cjk + kana === 0 && latin > 0) return false;
    return true;
  }
  if (code === "ko") {
    if (latin >= 4 && hangul === 0) return false;
    if (hangul === 0 && latin > 0) return false;
    return true;
  }
  return true;
}

function collectExerciseTexts(exercises) {
  const texts = [];
  for (const exercise of exercises || []) {
    for (const item of exercise.items || []) {
      texts.push(String(item.title || item.topic || "").trim());
      texts.push(String(item.correctAnswer || "").trim());
      for (const option of item.options || []) {
        texts.push(String(option?.text || option || "").trim());
      }
    }
  }
  return texts.filter(Boolean);
}

function collectWrongLanguageSamples(exercises, langCode) {
  const bad = [];
  for (const exercise of exercises || []) {
    for (const item of exercise.items || []) {
      const stem = String(item.title || item.topic || "").trim();
      if (stem && !textMatchesTargetLanguage(stem, langCode)) {
        bad.push(`question:"${stem}"`);
      }
      for (const option of item.options || []) {
        const text = String(option?.text || option || "").trim();
        if (text && !textMatchesTargetLanguage(text, langCode)) {
          bad.push(`option:"${text}"`);
        }
      }
      const rubric = String(item.correctAnswer || "").trim();
      if (rubric && !textMatchesTargetLanguage(rubric, langCode)) {
        bad.push(`answer:"${rubric}"`);
      }
    }
  }
  return bad.slice(0, 4);
}

function exerciseOutputLooksWrongLanguage(exercises, langCode) {
  return collectWrongLanguageSamples(exercises, langCode).length > 0;
}

function buildLanguageCorrectionPrompt(langCode, exercises) {
  const badSamples = collectWrongLanguageSamples(exercises, langCode);
  const sample = badSamples.join(" | ");
  const code = String(langCode || "en").toLowerCase();
  const traditionalNote =
    code === "zh" || code === "yue"
      ? " Use Traditional Chinese characters (繁體中文) only — never Simplified Chinese (简体中文). "
      : " ";
  return (
    `LANGUAGE CORRECTION REQUIRED: Your previous JSON mixed languages or scripts` +
    (sample ? ` (${sample})` : "") +
    ". Rewrite the ENTIRE exercises JSON again. " +
    "Every mcquiz/fastmcquiz item `title` (question stem) and every option `text` must be in the target language — never English stems with translated options. " +
    "Every buzzin item `topic` (the speaking prompt) and `correctAnswer` rubric must also be in the target language — never English topics." +
    traditionalNote +
    `${languageOutputRequirement(langCode)} Keep the same topics, difficulty, and correct answers, but translate everything into the target language. Return ONLY valid JSON.`
  );
}

function mergeTranslatedExercises(original, translated) {
  const orig = Array.isArray(original) ? original : [];
  const next = Array.isArray(translated) ? translated : [];
  return next.map((exercise, exerciseIndex) => {
    const origExercise = orig[exerciseIndex];
    if (!origExercise) return exercise;
    return {
      ...exercise,
      items: (exercise.items || []).map((item, itemIndex) => {
        const origItem = origExercise.items?.[itemIndex];
        if (!origItem) return item;
        return {
          ...item,
          image: origItem.image || item.image || null,
          imageRef: origItem.imageRef || item.imageRef || null,
          imageRefConfidence:
            origItem.imageRefConfidence ?? item.imageRefConfidence ?? null,
        };
      }),
    };
  });
}

async function translateExercisesToTargetLanguage({
  exercises,
  langCode,
  typeCounts,
  llmComplete,
  apiKey,
  model,
}) {
  const code = String(langCode || "en").toLowerCase();
  if (!exercises?.length || code === "en" || code === "es" || code === "fr") {
    return { exercises, translateAttempts: 0, translated: false };
  }

  const compact = compactDraftForRevision(exercises);
  let messages = [
    {
      role: "system",
      content:
        "You translate classroom exercise JSON into the target language. Return ONLY valid JSON: {\"exercises\":[...]}. " +
        "Keep identical structure: same types, same number of items, same isCorrect flags, same timeLimit values. " +
        "Translate ONLY text fields (exercise title, question title, buzzin topic, option text, correctAnswer rubric). " +
        "Do not add or remove items. " +
        languageOutputRequirement(langCode),
    },
    {
      role: "user",
      content:
        `Translate ALL student-facing text in this exercises JSON into ${languageName(langCode)}.\n\n` +
        JSON.stringify({ exercises: compact }),
    },
  ];

  let translateAttempts = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    translateAttempts += 1;
    const reply = await llmComplete(apiKey, model, messages, 6000);
    const parsed = parseJsonFromLlm(reply);
    const validated = validateGeneratedExercises(parsed, typeCounts);
    if (!validated.exercises.length) continue;

    const merged = mergeTranslatedExercises(exercises, validated.exercises);
    const stillWrong = exerciseOutputLooksWrongLanguage(merged, code);
    debugGenLog(
      "exercise-generator.js:translateExercisesToTargetLanguage",
      "translation attempt",
      {
        langCode: code,
        attempt: attempt + 1,
        stillWrong,
        badSamples: stillWrong ? collectWrongLanguageSamples(merged, code) : [],
        sampleOut: collectExerciseTexts(merged).slice(0, 3),
      },
      "H-GEN-TRANSLATE"
    );

    if (!stillWrong) {
      return { exercises: merged, translateAttempts, translated: true };
    }

    messages = [
      ...messages,
      { role: "assistant", content: JSON.stringify({ exercises: validated.exercises }) },
      { role: "user", content: buildLanguageCorrectionPrompt(langCode, merged) },
    ];
  }

  return { exercises, translateAttempts, translated: false };
}

async function ensureExercisesTargetLanguage(
  exercises,
  langCode,
  typeCounts,
  llmComplete,
  apiKey,
  model,
  languageRetriesSoFar = 0
) {
  const code = String(langCode || "en").toLowerCase();
  if (!exercises?.length || code === "en" || code === "es" || code === "fr") {
    return { exercises, languageRetries: languageRetriesSoFar, translated: false };
  }
  if (!exerciseOutputLooksWrongLanguage(exercises, code)) {
    return { exercises, languageRetries: languageRetriesSoFar, translated: false };
  }

  debugGenLog(
    "exercise-generator.js:ensureExercisesTargetLanguage",
    "wrong language detected; starting translation pass",
    {
      langCode: code,
      badSamples: collectWrongLanguageSamples(exercises, code),
    },
    "H-GEN-LANG"
  );

  const translated = await translateExercisesToTargetLanguage({
    exercises,
    langCode: code,
    typeCounts,
    llmComplete,
    apiKey,
    model,
  });

  if (exerciseOutputLooksWrongLanguage(translated.exercises, code)) {
    debugGenLog(
      "exercise-generator.js:ensureExercisesTargetLanguage",
      "translation pass failed",
      {
        langCode: code,
        badSamples: collectWrongLanguageSamples(translated.exercises, code),
        translateAttempts: translated.translateAttempts,
      },
      "H-GEN-LANG"
    );
    throw new Error(
      `Could not generate exercises in ${languageName(code)}. Please try generating again.`
    );
  }

  return {
    exercises: translated.exercises,
    languageRetries: languageRetriesSoFar + translated.translateAttempts,
    translated: translated.translated,
  };
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

function formatTeacherInstructions(instructions) {
  const text = String(instructions || "").trim();
  if (!text) return "";
  return (
    `TEACHER INSTRUCTIONS — MUST FOLLOW (scope filter):\n${text}\n\n` +
    "CRITICAL: Generate exercises ONLY from content that matches these instructions. " +
    "Do NOT use other tenses, topics, sections, or examples from the source. " +
    "If the source is broader than the instructions, ignore the extra parts completely.\n\n"
  );
}

function buildGenerationPrompt({ material, langCode, difficulty, typeCounts, instructions, imageAssets }) {
  const targetLanguage = languageName(langCode);
  const instructionBlock = formatTeacherInstructions(instructions);
  const imageCatalog = materialImages.buildImageAssetCatalogBlock(imageAssets);
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
        (instructionBlock
          ? "Teacher instructions define mandatory scope; never violate them even if the source contains more content. "
          : "") +
        "Return ONLY valid JSON (no markdown fences, no commentary). " +
        'Schema: {"exercises":[{"type":"mcquiz|fastmcquiz|buzzin","title":"string","subTitle":"string","items":[...]}]}. ' +
        "For mcquiz/fastmcquiz items: {title, options:[{text,isCorrect}], timeLimit, imageRef:null, imageRefConfidence:null}. " +
        "The title field is the question stem shown to students — it MUST be in the target language, never English when target is not English. " +
        "For buzzin items: {topic, correctAnswer, imageRef:null, imageRefConfidence:null}. " +
        "The buzzin topic field is the student-facing speaking prompt — it MUST be in the target language (for Chinese use 繁體中文, e.g. 描述照片中的過山車), never English when target is not English. " +
        "When IMAGE ASSET CATALOG is provided, set imageRef only when a catalog image clearly matches that exact question (same scene/object/topic). " +
        "Set imageRefConfidence as a decimal from 0.0 to 1.0 (not 0-100). Use imageRef null unless confidence would be at least 0.7. " +
        'Example item with image: {"title":"Where are the children playing?","imageRef":"mat-123","imageRefConfidence":0.82,...}. ' +
        "Do not use an image URL field; only imageRef + imageRefConfidence. " +
        "Never invent imageRef ids. " +
        "Every mc option set must have exactly one isCorrect:true. " +
        "Questions must be faithful to the allowed material but not copy long passages verbatim. " +
        languageOutputRequirement(langCode),
    },
    {
      role: "user",
      content:
        `${languageOutputRequirement(langCode)}\n` +
        `Target learner language: ${targetLanguage}.\n` +
        `${difficultyGuidance(difficulty)}\n\n` +
        `Generate:\n${requests.join("\n")}\n\n` +
        `Use these subTitle values: mcquiz → "MC Quiz", fastmcquiz → "Fast MC Quiz", buzzin → "Buzz In".\n` +
        `Group items of the same type into one exercise object when practical.\n\n` +
        instructionBlock +
        imageCatalog +
        "IMPORTANT: Source material may be in a different language than the target output language. " +
        "Still write every question and every answer option ONLY in the target language.\n\n" +
        `SOURCE MATERIAL (markdown — use only parts allowed by the instructions above):\n${material}`,
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

  let imageRef = item?.imageRef ? String(item.imageRef).trim() : null;
  const directImage = String(item?.image || item?.imageUrl || "").trim();
  if (!imageRef && directImage) {
    const inferred = directImage.match(/\/uploads\/material\/(mat-[A-Za-z0-9-]+)/i);
    if (inferred) imageRef = inferred[1];
    else if (/^mat-[A-Za-z0-9-]+$/i.test(directImage)) imageRef = directImage;
  }

  return {
    title,
    options,
    timeLimit,
    image: null,
    imageRef,
    imageRefConfidence: materialImages.parseImageRefConfidence(item),
  };
}

function normalizeBuzzinItem(item) {
  const topic = String(item?.topic || "").trim();
  if (!topic) return null;
  const correctAnswer = String(item?.correctAnswer || item?.rubric || "").trim();
  const imageRef = String(item?.imageRef || "").trim();
  const imageRefConfidence = materialImages.parseImageRefConfidence(item);
  return {
    topic,
    correctAnswer:
      correctAnswer ||
      "Any clear, relevant spoken answer that uses the lesson vocabulary is acceptable.",
    image: null,
    ...(imageRef ? { imageRef } : {}),
    ...(imageRefConfidence != null ? { imageRefConfidence } : {}),
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

const MAX_SCOPE_INPUT_CHARS = 32000;

async function scopeMaterialWithInstructions(material, instructions, llmComplete, apiKey, model) {
  const instr = String(instructions || "").trim();
  const source = String(material || "").trim();
  if (!instr || !source || typeof llmComplete !== "function") return source;

  const clipped =
    source.length > MAX_SCOPE_INPUT_CHARS
      ? `${source.slice(0, MAX_SCOPE_INPUT_CHARS)}\n\n[…truncated for scoping]`
      : source;

  const messages = [
    {
      role: "system",
      content:
        "You filter classroom source material to match teacher scope instructions. " +
        "Return ONLY the matching excerpts as plain text or markdown. " +
        "No commentary, no JSON, no preamble. " +
        "If instructions limit tense/topic/section, include ONLY that portion.",
    },
    {
      role: "user",
      content:
        `TEACHER INSTRUCTIONS:\n${instr}\n\n` +
        `SOURCE DOCUMENT:\n${clipped}\n\n` +
        "Return only the excerpts that match the instructions.",
    },
  ];

  const reply = await llmComplete(
    apiKey,
    model,
    messages,
    Math.min(6000, 900 + Math.floor(clipped.length / 5))
  );
  const scoped = String(reply || "").trim();
  return scoped.length > 80 ? scoped : source;
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

  const model = String(options.model || DEFAULT_GENERATE_MODEL).trim() || DEFAULT_GENERATE_MODEL;
  const instructions = String(options.instructions || "").trim();
  let workingMaterial = material;

  if (instructions) {
    workingMaterial = await scopeMaterialWithInstructions(
      material,
      instructions,
      llmComplete,
      options.apiKey,
      model
    );
  }

  const messages = buildGenerationPrompt({
    material: workingMaterial,
    langCode: options.langCode,
    difficulty: options.difficulty,
    typeCounts,
    instructions,
    imageAssets: options.imageAssets,
  });

  const totalItems = Object.values(typeCounts).reduce((sum, n) => sum + n, 0);
  const maxTokens = Math.min(8000, 400 + totalItems * 180);
  const langCode = String(options.langCode || "en").trim().toLowerCase();

  debugGenLog(
    "exercise-generator.js:generateExercisesFromMaterial",
    "generation start",
    { langCode, typeCounts, totalItems },
    "H-GEN-LANG"
  );

  let lastError = null;
  let languageRetries = 0;
  let attemptMessages = messages;
  let pendingValidated = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const reply = await llmComplete(options.apiKey, model, attemptMessages, maxTokens);
      const parsed = parseJsonFromLlm(reply);
      const validated = validateGeneratedExercises(parsed, typeCounts);
      const wrongLanguage =
        validated.exercises.length &&
        exerciseOutputLooksWrongLanguage(validated.exercises, langCode);

      debugGenLog(
        "exercise-generator.js:generateExercisesFromMaterial",
        "generation attempt",
        {
          attempt: attempt + 1,
          langCode,
          wrongLanguage,
          badSamples: wrongLanguage
            ? collectWrongLanguageSamples(validated.exercises, langCode)
            : [],
          itemCount: validated.exercises.length,
        },
        "H-GEN-LANG"
      );

      if (wrongLanguage && attempt < 2) {
        languageRetries += 1;
        pendingValidated = validated;
        attemptMessages = [
          ...messages,
          { role: "assistant", content: JSON.stringify({ exercises: validated.exercises }) },
          { role: "user", content: buildLanguageCorrectionPrompt(langCode, validated.exercises) },
        ];
        lastError = new Error(
          `Generated exercises mixed languages: ${collectWrongLanguageSamples(validated.exercises, langCode).join("; ")}`
        );
        continue;
      }

      if (validated.exercises.length && (validated.ok || attempt >= 1)) {
        if (wrongLanguage) {
          pendingValidated = validated;
          lastError = new Error(
            `Generated exercises mixed languages: ${collectWrongLanguageSamples(validated.exercises, langCode).join("; ")}`
          );
          break;
        }

        const ensured = await ensureExercisesTargetLanguage(
          validated.exercises,
          langCode,
          typeCounts,
          llmComplete,
          options.apiKey,
          model,
          languageRetries
        );
        materialImages.logGeneratedImageFields(ensured.exercises);
        debugGenLog(
          "exercise-generator.js:generateExercisesFromMaterial",
          "generation success",
          {
            langCode,
            languageRetries: ensured.languageRetries,
            translated: ensured.translated,
            sampleOut: collectExerciseTexts(ensured.exercises).slice(0, 3),
          },
          "H-GEN-LANG"
        );
        return {
          exercises: ensured.exercises,
          model,
          stats: {
            requested: totalItems,
            generated: Object.values(validated.itemCounts).reduce((sum, n) => sum + n, 0),
            itemCounts: validated.itemCounts,
            partial: !validated.ok,
            missing: validated.missing,
            langCode,
            languageRetries: ensured.languageRetries,
            translated: ensured.translated,
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

  if (pendingValidated?.exercises?.length) {
    const ensured = await ensureExercisesTargetLanguage(
      pendingValidated.exercises,
      langCode,
      typeCounts,
      llmComplete,
      options.apiKey,
      model,
      languageRetries
    );
    materialImages.logGeneratedImageFields(ensured.exercises);
    debugGenLog(
      "exercise-generator.js:generateExercisesFromMaterial",
      "generation success after translation pass",
      {
        langCode,
        languageRetries: ensured.languageRetries,
        translated: ensured.translated,
        sampleOut: collectExerciseTexts(ensured.exercises).slice(0, 3),
      },
      "H-GEN-LANG"
    );
    return {
      exercises: ensured.exercises,
      model,
      stats: {
        requested: totalItems,
        generated: Object.values(pendingValidated.itemCounts).reduce((sum, n) => sum + n, 0),
        itemCounts: pendingValidated.itemCounts,
        partial: !pendingValidated.ok,
        missing: pendingValidated.missing,
        langCode,
        languageRetries: ensured.languageRetries,
        translated: ensured.translated,
      },
    };
  }

  throw lastError || new Error("Exercise generation failed.");
}

function normalizeImportedExercises(exercises) {
  return (Array.isArray(exercises) ? exercises : [])
    .map(normalizeGeneratedExercise)
    .filter(Boolean);
}

function compactDraftForRevision(exercises) {
  let questionNumber = 0;
  return (Array.isArray(exercises) ? exercises : [])
    .filter((exercise) => exercise && exercise.type !== "video")
    .map((exercise) => {
      const type = String(exercise.type || "").trim();
      const base = {
        type,
        title: String(exercise.title || "").trim(),
        included: exercise.included !== false,
      };
      if (type === "buzzin") {
        base.items = (exercise.items || []).map((item) => {
          questionNumber += 1;
          return {
            questionNumber,
            topic: String(item.topic || "").trim(),
            correctAnswer: String(item.correctAnswer || "").trim(),
          };
        });
        return base;
      }
      base.items = (exercise.items || []).map((item) => {
        questionNumber += 1;
        return {
          questionNumber,
          title: String(item.title || "").trim(),
          timeLimit: Number(item.timeLimit) || (type === "fastmcquiz" ? 10 : 15),
          options: (item.options || []).map((opt) => ({
            text: String(opt.text || "").trim(),
            isCorrect: Boolean(opt.isCorrect),
          })),
        };
      });
      return base;
    });
}

function clipRevisionMaterial(material) {
  const source = String(material || "").trim();
  if (source.length <= MAX_SCOPE_INPUT_CHARS) return source;
  return `${source.slice(0, MAX_SCOPE_INPUT_CHARS)}\n\n[…truncated]`;
}

function formatRevisionHistory(history) {
  const turns = (Array.isArray(history) ? history : [])
    .map((turn) => {
      const role = turn?.role === "assistant" ? "Assistant" : "Teacher";
      const content = String(turn?.content || "").trim();
      return content ? `${role}: ${content}` : "";
    })
    .filter(Boolean)
    .slice(-8);
  if (!turns.length) return "";
  return `PREVIOUS REVISION TURNS:\n${turns.join("\n")}\n\n`;
}

function parseAddQuestionIntent(revision) {
  const text = String(revision || "").trim().toLowerCase();
  const patterns = [
    { re: /add\s+(\d+)\s+(?:fast\s*mc(?:\s*quiz)?|fastmcquiz)/i, type: "fastmcquiz" },
    { re: /add\s+(\d+)\s+(?:mc\s*quiz|mcquiz)/i, type: "mcquiz" },
    { re: /add\s+(\d+)\s+(?:buzz\s*in(?:\s+question)?|buzzin)/i, type: "buzzin" },
  ];
  for (const { re, type } of patterns) {
    const match = text.match(re);
    if (match) {
      return { count: Math.max(1, Number.parseInt(match[1], 10) || 1), type };
    }
  }
  return null;
}

function resolveQuestionTargetType(typeRaw) {
  const normalized = String(typeRaw || "").toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("fast")) return "fastmcquiz";
  if (normalized.includes("buzz")) return "buzzin";
  return "mcquiz";
}

const CONVERT_VERB_PATTERN =
  "(?:make|convert|change|turn|replace|swap|rewrite|switch)";
const TARGET_TYPE_PATTERN =
  "(fast\\s*mc(?:\\s*quiz)?|fastmcquiz|mc\\s*quiz|mcquiz|buzz\\s*in(?:\\s+question)?|buzzin)";
const TARGET_CONNECTOR_PATTERN = "(?:to|into|with|as|for)";

function validContextQuestionNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseTargetTypeFromRevision(revision) {
  const text = String(revision || "");
  const anchored = text.match(
    new RegExp(
      `${TARGET_CONNECTOR_PATTERN}\\s*(?:a\\s+|an\\s+)?(${TARGET_TYPE_PATTERN})`,
      "i"
    )
  );
  if (anchored) return resolveQuestionTargetType(anchored[1]);
  const loose = text.match(new RegExp(`\\b(${TARGET_TYPE_PATTERN})\\b`, "i"));
  return loose ? resolveQuestionTargetType(loose[1]) : null;
}

function isConvertLikeRevision(revision) {
  return new RegExp(`\\b${CONVERT_VERB_PATTERN}\\b`, "i").test(String(revision || ""));
}

function parseQuestionNumberFromText(text) {
  const match = String(text || "").match(/question\s*(\d+)/i);
  if (!match) return null;
  return Math.max(1, Number.parseInt(match[1], 10) || 1);
}

function parseSwitchTargetType(revision) {
  const match = String(revision || "").match(
    new RegExp(
      `${CONVERT_VERB_PATTERN}\\s+(?:this|it)\\s+${TARGET_CONNECTOR_PATTERN}\\s*(?:a\\s+|an\\s+)?(${TARGET_TYPE_PATTERN})`,
      "i"
    )
  );
  return match ? resolveQuestionTargetType(match[1]) : null;
}

function parseBareReplaceTargetType(revision) {
  const match = String(revision || "").match(
    new RegExp(
      `${CONVERT_VERB_PATTERN}\\s+${TARGET_CONNECTOR_PATTERN}\\s*(?:a\\s+|an\\s+)?(${TARGET_TYPE_PATTERN})`,
      "i"
    )
  );
  return match ? resolveQuestionTargetType(match[1]) : null;
}

function parseConvertQuestionIntent(revision, contextQuestionNumber) {
  const text = String(revision || "").trim();
  const contextNumber = validContextQuestionNumber(contextQuestionNumber);

  const direct = text.match(
    new RegExp(
      `${CONVERT_VERB_PATTERN}\\s+(?:the\\s+)?(?:q(?:uestion)?\\s*)?(\\d+)\\s+${TARGET_CONNECTOR_PATTERN}\\s*(?:a\\s+|an\\s+)?(${TARGET_TYPE_PATTERN})`,
      "i"
    )
  );
  if (direct) {
    return {
      questionNumber: Math.max(1, Number.parseInt(direct[1], 10) || 1),
      targetType: resolveQuestionTargetType(direct[2]),
    };
  }

  const referentType = parseSwitchTargetType(text);
  if (referentType) {
    const questionNumber = parseQuestionNumberFromText(text) || contextNumber;
    if (questionNumber) {
      return { questionNumber, targetType: referentType };
    }
  }

  const bareReplaceType = parseBareReplaceTargetType(text);
  if (bareReplaceType) {
    const questionNumber = parseQuestionNumberFromText(text) || contextNumber;
    if (questionNumber) {
      return { questionNumber, targetType: bareReplaceType };
    }
  }

  const fallbackType = parseTargetTypeFromRevision(text);
  const questionNumber = parseQuestionNumberFromText(text) || contextNumber;
  if (fallbackType && questionNumber && isConvertLikeRevision(text)) {
    return { questionNumber, targetType: fallbackType };
  }

  return null;
}

function flattenDraftQuestions(exercises) {
  const flat = [];
  (Array.isArray(exercises) ? exercises : []).forEach((exercise, exerciseIndex) => {
    if (!exercise || exercise.type === "video") return;
    (exercise.items || []).forEach((item, itemIndex) => {
      flat.push({
        questionNumber: flat.length + 1,
        exerciseIndex,
        itemIndex,
        type: exercise.type,
        item: { ...item },
        exerciseMeta: {
          title: exercise.title,
          subTitle: exercise.subTitle,
          included: exercise.included,
          _courseGroup: exercise._courseGroup,
          _courseKey: exercise._courseKey,
          _sectionTitle: exercise._sectionTitle,
        },
      });
    });
  });
  return flat;
}

function rebuildExercisesFromFlat(flat, previousExercises) {
  if (!flat.length) return [];
  const segments = [];
  for (const entry of flat) {
    const last = segments[segments.length - 1];
    if (last && last.type === entry.type) {
      last.items.push(entry.item);
    } else {
      segments.push({ type: entry.type, items: [entry.item] });
    }
  }

  const priorPool = (Array.isArray(previousExercises) ? previousExercises : []).filter(
    (exercise) => exercise?.type && exercise.type !== "video"
  );
  const usedPrior = new Set();

  return segments.map((segment) => {
    let priorIndex = priorPool.findIndex(
      (exercise, index) => !usedPrior.has(index) && exercise.type === segment.type
    );
    if (priorIndex < 0) {
      priorIndex = priorPool.findIndex((exercise) => exercise.type === segment.type);
    }
    const prior = priorIndex >= 0 ? priorPool[priorIndex] : null;
    if (priorIndex >= 0) usedPrior.add(priorIndex);
    const fallback = priorPool[0];
    const firstItemTitle =
      segment.type === "buzzin"
        ? String(segment.items[0]?.topic || "").trim()
        : String(segment.items[0]?.title || "").trim();
    return {
      type: segment.type,
      title: prior?.title || firstItemTitle.slice(0, 120) || TYPE_TITLES[segment.type],
      subTitle: prior?.subTitle || TYPE_LABELS[segment.type],
      included: prior?.included !== false,
      items: segment.items,
      _courseGroup: prior?._courseGroup ?? fallback?._courseGroup,
      _courseKey: prior?._courseKey ?? fallback?._courseKey,
      _sectionTitle: prior?._sectionTitle ?? fallback?._sectionTitle,
    };
  });
}

async function convertItemWithLlm(options, llmComplete) {
  const { sourceType, targetType, item, material, langCode, difficulty, instructions, apiKey, model } =
    options;
  const messages = [
    {
      role: "system",
      content:
        "Convert one classroom exercise item to a new question type. " +
        "Keep the same topic and learning goal from the source item. " +
        languageOutputRequirement(langCode) + " " +
        "Return ONLY valid JSON for the single converted item (no markdown). " +
        (targetType === "buzzin"
          ? 'Schema: {"topic":"string","correctAnswer":"string"}'
          : 'Schema: {"title":"string","options":[{"text":"string","isCorrect":boolean}],"timeLimit":number,"image":null}') +
        ". Exactly one option must have isCorrect:true for mc types.",
    },
    {
      role: "user",
      content:
        `${languageOutputRequirement(langCode)}\n` +
        `Convert from ${sourceType} to ${targetType}.\n` +
        `Target language: ${languageName(langCode)}.\n` +
        `${difficultyGuidance(difficulty)}\n\n` +
        formatTeacherInstructions(instructions) +
        `SOURCE ITEM:\n${JSON.stringify(item)}\n\n` +
        `REFERENCE MATERIAL:\n${material}`,
    },
  ];
  const reply = await llmComplete(apiKey, model, messages, 1200);
  const parsed = parseJsonFromLlm(reply);
  const raw = parsed?.item ?? parsed;
  if (targetType === "buzzin") {
    const normalized = normalizeBuzzinItem(raw);
    if (!normalized) throw new Error("Could not convert to Buzz In question.");
    return normalized;
  }
  const normalized = normalizeMcItem(raw, { fast: targetType === "fastmcquiz" });
  if (!normalized) throw new Error("Could not convert to quiz question.");
  return normalized;
}

async function convertQuestionInDraft(options, llmComplete) {
  const { convertIntent, editable, videos, material, model, apiKey } = options;
  const { questionNumber, targetType } = convertIntent;
  const flat = flattenDraftQuestions(editable);
  if (questionNumber < 1 || questionNumber > flat.length) {
    throw new Error(`Question ${questionNumber} does not exist.`);
  }

  const target = flat[questionNumber - 1];
  if (target.type === targetType) {
    return {
      exercises: [...editable, ...videos],
      summary: `Question ${questionNumber} is already ${TYPE_LABELS[targetType]}.`,
      model,
      stats: { previous: editable.length, next: editable.length, videos: videos.length },
    };
  }

  const convertedItem = await convertItemWithLlm(
    {
      sourceType: target.type,
      targetType,
      item: target.item,
      material,
      langCode: options.langCode,
      difficulty: options.difficulty,
      instructions: options.instructions,
      apiKey,
      model,
    },
    llmComplete
  );

  flat[questionNumber - 1] = {
    ...target,
    type: targetType,
    item: convertedItem,
  };

  const rebuilt = rebuildExercisesFromFlat(flat, editable);
  const exercises = [...rebuilt, ...videos];
  const summary = `Converted question ${questionNumber} to ${TYPE_LABELS[targetType]}.`;

  return {
    exercises,
    summary,
    model,
    revisionMode: "convert-in-place",
    stats: { previous: editable.length, next: rebuilt.length, videos: videos.length },
  };
}

function countItemsByType(exercises, type) {
  return (Array.isArray(exercises) ? exercises : []).reduce((sum, exercise) => {
    if (!exercise || exercise.type !== type) return sum;
    return sum + (exercise.items?.length || 0);
  }, 0);
}

function trimExcessAddedItems(previous, next, type, maxAdded) {
  const prevCount = countItemsByType(previous, type);
  const allowedTotal = prevCount + maxAdded;
  const currentCount = countItemsByType(next, type);
  if (currentCount <= allowedTotal) return next;

  let toRemove = currentCount - allowedTotal;
  const result = (Array.isArray(next) ? next : []).map((exercise) => ({
    ...exercise,
    items: [...(exercise.items || [])],
  }));

  for (let i = result.length - 1; i >= 0 && toRemove > 0; i -= 1) {
    if (result[i].type !== type) continue;
    const items = result[i].items;
    while (items.length > 0 && toRemove > 0) {
      items.pop();
      toRemove -= 1;
    }
  }

  return result.filter((exercise) => exercise.type === "video" || (exercise.items && exercise.items.length));
}

function restoreDraftMetadata(previous, next) {
  const prior = Array.isArray(previous) ? previous : [];
  const pool = prior.map((exercise) => ({ ...exercise }));
  const uniqueKeys = [...new Set(prior.map((exercise) => exercise._courseKey).filter((key) => key != null))];
  const fallback = uniqueKeys.length === 1 ? prior.find((exercise) => exercise._courseKey === uniqueKeys[0]) : prior[0];
  return (Array.isArray(next) ? next : []).map((exercise) => {
    const type = exercise.type;
    const title = String(exercise.title || "").trim();
    let matchIndex = pool.findIndex(
      (candidate) => candidate.type === type && String(candidate.title || "").trim() === title
    );
    if (matchIndex < 0) matchIndex = pool.findIndex((candidate) => candidate.type === type);
    const match = matchIndex >= 0 ? pool.splice(matchIndex, 1)[0] : null;
    return {
      ...exercise,
      included: exercise.included !== false,
      _courseGroup: match?._courseGroup ?? fallback?._courseGroup,
      _courseKey: match?._courseKey ?? fallback?._courseKey,
      _sectionTitle: match?._sectionTitle ?? fallback?._sectionTitle,
    };
  });
}

function buildRevisionPrompt({
  material,
  langCode,
  difficulty,
  instructions,
  draft,
  revision,
  history,
  imageAssets,
}) {
  const targetLanguage = languageName(langCode);
  const instructionBlock = formatTeacherInstructions(instructions);
  const historyBlock = formatRevisionHistory(history);
  const imageCatalog = materialImages.buildImageAssetCatalogBlock(imageAssets);
  return [
    {
      role: "system",
      content:
        "You revise classroom language-learning exercises already drafted for a teacher. " +
        "Apply the teacher's revision request to the CURRENT DRAFT. " +
        "Keep items the teacher did not mention, unless they asked to replace, remove, or filter them. " +
        "You may add, edit, reorder, merge, split, or remove questions. " +
        "Each item in the draft includes questionNumber — a global index across all exercises in order. " +
        "When the teacher refers to 'question N', use that questionNumber. " +
        "When the teacher specifies a number (e.g. 'add 1 Fast MC Quiz'), add exactly that many question items total—not a full exercise with multiple questions. " +
        "'Add 1 Fast MC Quiz' means one fastmcquiz question item. " +
        "When converting or replacing question N with another type, replace that question in place at the same questionNumber. Do not append a new question. " +
        "You may add new exercise types (mcquiz, fastmcquiz, buzzin) when asked. " +
        "Do not invent topics that are not in the source material. " +
        "Never return video exercises. " +
        "Return ONLY valid JSON (no markdown fences, no commentary). " +
        'Schema: {"summary":"short change summary","exercises":[{"type":"mcquiz|fastmcquiz|buzzin","title":"string","subTitle":"string","included":true,"items":[...]}]}. ' +
        "For mcquiz/fastmcquiz items: {title, options:[{text,isCorrect}], timeLimit, imageRef:null, imageRefConfidence:null}. " +
        "The title field is the question stem shown to students — it MUST be in the target language, never English when target is not English. " +
        "For buzzin items: {topic, correctAnswer, imageRef:null, imageRefConfidence:null}. " +
        "When IMAGE ASSET CATALOG is provided, set imageRef only when a catalog image clearly matches that question. " +
        "Set imageRefConfidence as a decimal from 0.0 to 1.0 (not 0-100) and use imageRef null unless confidence would be at least 0.7. " +
        "Every mc option set must have exactly one isCorrect:true. " +
        "summary must be one short sentence describing what changed. " +
        languageOutputRequirement(langCode),
    },
    {
      role: "user",
      content:
        `${languageOutputRequirement(langCode)}\n` +
        `Target learner language: ${targetLanguage}.\n` +
        `${difficultyGuidance(difficulty)}\n\n` +
        instructionBlock +
        historyBlock +
        imageCatalog +
        `CURRENT DRAFT JSON:\n${JSON.stringify({ exercises: draft })}\n\n` +
        `TEACHER REVISION REQUEST:\n${revision}\n\n` +
        `SOURCE MATERIAL (use only parts allowed by the instructions above):\n${material}`,
    },
  ];
}

async function reviseExercisesFromDraft(options, llmComplete) {
  if (typeof llmComplete !== "function") {
    throw new Error("LLM complete function is required.");
  }

  const revision = String(options.revision || "").trim();
  if (!revision) throw new Error("Describe the change you want.");

  const previous = Array.isArray(options.exercises) ? options.exercises : [];
  const videos = previous.filter((exercise) => exercise?.type === "video");
  const editable = previous.filter((exercise) => exercise?.type && exercise.type !== "video");
  if (!editable.length) {
    throw new Error("Generate questions first, then ask the assistant to edit them.");
  }

  const material = clipRevisionMaterial(options.material);
  if (!material) throw new Error("Source material is required to revise questions.");

  const model = String(options.model || DEFAULT_GENERATE_MODEL).trim() || DEFAULT_GENERATE_MODEL;
  const convertIntent = parseConvertQuestionIntent(revision, options.questionNumber);
  if (convertIntent) {
    return convertQuestionInDraft(
      { ...options, revision, editable, videos, convertIntent, material, model },
      llmComplete
    );
  }

  const draft = compactDraftForRevision(editable);
  const messages = buildRevisionPrompt({
    material,
    langCode: options.langCode,
    difficulty: options.difficulty,
    instructions: options.instructions,
    draft,
    revision,
    history: options.history,
    imageAssets: options.imageAssets,
  });

  const itemCount = draft.reduce((sum, exercise) => sum + (exercise.items?.length || 0), 0);
  const maxTokens = Math.min(8000, 700 + itemCount * 160);
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reply = await llmComplete(options.apiKey, model, messages, maxTokens);
      const parsed = parseJsonFromLlm(reply);
      const rawExercises = Array.isArray(parsed?.exercises) ? parsed.exercises : [];
      const normalized = normalizeImportedExercises(rawExercises)
        .filter((exercise) => exercise.type !== "video")
        .map((exercise, index) => ({
          ...exercise,
          included: rawExercises[index]?.included !== false,
        }));
      if (!normalized.length) {
        lastError = new Error("The assistant returned no valid questions.");
        continue;
      }
      const withMeta = restoreDraftMetadata(editable, normalized);
      const addIntent = parseAddQuestionIntent(revision);
      const trimmed = addIntent
        ? trimExcessAddedItems(editable, withMeta, addIntent.type, addIntent.count)
        : withMeta;
      const exercises = [...trimmed, ...videos];
      const summary =
        String(parsed?.summary || "").trim() ||
        `Updated ${trimmed.length} exercise(s).`;
      return {
        exercises,
        summary,
        model,
        revisionMode: "llm",
        stats: {
          previous: editable.length,
          next: trimmed.length,
          videos: videos.length,
        },
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Exercise revision failed.");
}

module.exports = {
  DEFAULT_GENERATE_MODEL,
  TYPE_LABELS,
  normalizeTypeCounts,
  buildGenerationPrompt,
  scopeMaterialWithInstructions,
  parseJsonFromLlm,
  validateGeneratedExercises,
  normalizeImportedExercises,
  compactDraftForRevision,
  generateExercisesFromMaterial,
  reviseExercisesFromDraft,
};
