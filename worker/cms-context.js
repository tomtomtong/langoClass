// GET /api/cms/app-context, as server.js served it: the CMS's language lists
// and gameplay TTS flags. Lists come from lib/cms-speak-languages.js.
import { speechProvider, speechReady } from "./ai.js";

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

export function cmsAppContext(env) {
  const appVariant = String(env?.APP_VARIANT || "").trim();
  const elderly = appVariant === "hk-elderly";
  const questionLanguages = new Map(CMS_QUESTION_LANGUAGES.map((entry) => [entry.code.toLowerCase(), entry]));
  if (elderly) {
    for (const entry of GROK_TTS_SPEAK_LANGUAGES) {
      if (!questionLanguages.has(entry.code.toLowerCase())) questionLanguages.set(entry.code.toLowerCase(), entry);
    }
  }
  return {
    appVariant,
    speakLanguages: elderly ? GROK_TTS_SPEAK_LANGUAGES : INWORLD_CLASSROOM_SPEAK_LANGUAGES,
    questionLanguages: [...questionLanguages.values()],
    defaultSpeakLangCode: elderly ? "yue" : "en",
    ttsProvider: speechProvider(env, appVariant),
    ttsAvailable: speechReady(env, appVariant),
  };
}
