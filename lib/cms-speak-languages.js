/**
 * CMS "Question speech language" options — aligned with gameplay TTS providers.
 * HK elderly (Grok via OpenRouter): xAI Grok Voice TTS supported languages.
 * Classroom (Inworld): English only for now.
 */

const GROK_TTS_SPEAK_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "yue", label: "Cantonese" },
  { code: "ar-EG", label: "Arabic (Egypt)" },
  { code: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { code: "ar-AE", label: "Arabic (United Arab Emirates)" },
  { code: "bn", label: "Bengali" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "ru", label: "Russian" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
];

const INWORLD_CLASSROOM_SPEAK_LANGUAGES = [{ code: "en", label: "English" }];

/** Languages teachers can generate questions in (not limited to classroom TTS). */
const CMS_QUESTION_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "yue", label: "Cantonese" },
  { code: "zh", label: "Chinese (Traditional)" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "hi", label: "Hindi" },
  { code: "ar-SA", label: "Arabic" },
];

/** Labels for legacy course codes still stored in the database. */
const LEGACY_SPEAK_LANG_LABELS = {
  yue: "Cantonese",
  es: "Spanish",
  zh: "Chinese",
};

function isHkElderlyVariant(appVariant) {
  return String(appVariant || "").trim() === "hk-elderly";
}

function getCmsSpeakLanguages(appVariant) {
  return isHkElderlyVariant(appVariant)
    ? GROK_TTS_SPEAK_LANGUAGES
    : INWORLD_CLASSROOM_SPEAK_LANGUAGES;
}

function getDefaultCmsSpeakLangCode(appVariant) {
  return isHkElderlyVariant(appVariant) ? "yue" : "en";
}

function getCmsQuestionLanguages(appVariant) {
  const byCode = new Map();
  for (const entry of CMS_QUESTION_LANGUAGES) {
    byCode.set(String(entry.code).toLowerCase(), entry);
  }
  if (isHkElderlyVariant(appVariant)) {
    for (const entry of GROK_TTS_SPEAK_LANGUAGES) {
      const key = String(entry.code).toLowerCase();
      if (!byCode.has(key)) byCode.set(key, entry);
    }
  }
  return [...byCode.values()];
}

/** BCP-47 language codes accepted by x-ai/grok-voice-tts-1.0 (eve supports Cantonese via yue). */
function speakLangToGrokTtsLanguage(code) {
  const raw = String(code || "").trim().replace(/_/g, "-");
  const lower = raw.toLowerCase();
  const match = GROK_TTS_SPEAK_LANGUAGES.find((entry) => entry.code.toLowerCase() === lower);
  if (match) return match.code;
  if (lower === "yue" || lower.startsWith("yue-")) return "yue";
  if (lower === "zh-hk" || lower === "zh-hant-hk") return "yue";
  return lower.split("-")[0] || "en";
}

function speakLangLabel(code, appVariant) {
  const key = String(code || "en").trim();
  const lower = key.toLowerCase();
  const languages = getCmsSpeakLanguages(appVariant);
  const match = languages.find((entry) => entry.code.toLowerCase() === lower);
  if (match) return match.label;
  if (LEGACY_SPEAK_LANG_LABELS[lower]) return LEGACY_SPEAK_LANG_LABELS[lower];
  return key;
}

function isAllowedCmsSpeakLangCode(code, appVariant) {
  const lower = String(code || "").trim().toLowerCase();
  return getCmsSpeakLanguages(appVariant).some((entry) => entry.code.toLowerCase() === lower);
}

module.exports = {
  GROK_TTS_SPEAK_LANGUAGES,
  INWORLD_CLASSROOM_SPEAK_LANGUAGES,
  CMS_QUESTION_LANGUAGES,
  LEGACY_SPEAK_LANG_LABELS,
  getCmsSpeakLanguages,
  getCmsQuestionLanguages,
  getDefaultCmsSpeakLangCode,
  speakLangLabel,
  speakLangToGrokTtsLanguage,
  isAllowedCmsSpeakLangCode,
};
