// GET /api/cms/app-context, as server.js served it: the CMS's language lists
// and gameplay TTS flags. Lists come from lib/cms-speak-languages.js.
import { speechProvider, speechReady } from "./ai.js";

const GROK_TTS_SPEAK_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "yue", label: "Cantonese (粵語)" },
  { code: "zh", label: "Mandarin (普通話, Traditional Chinese)" },
];

const INWORLD_CLASSROOM_SPEAK_LANGUAGES = GROK_TTS_SPEAK_LANGUAGES;

const CMS_QUESTION_LANGUAGES = GROK_TTS_SPEAK_LANGUAGES;

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
