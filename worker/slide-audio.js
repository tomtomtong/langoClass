// Voice clips for slides: a teacher can switch on "read the slides aloud" and
// each slide's text is turned into speech. Unlike the question speech cache,
// the clip is kept as a normal upload (/uploads/slides/...) so the host's audio
// element can play it and a course export or copy carries it along.
import { speak, speechReady } from "./ai.js";
import { randomPart, storeUpload, uploadUrl } from "./course-files.js";
import { json, readJson, requireTeacher } from "./d1-store.js";

const MAX_SLIDES = 30;
const MAX_TEXT = 1200;
const CONCURRENCY = 3;

export async function handleSlideAudioApi(request, env, url) {
  if (request.method.toUpperCase() !== "POST" || url.pathname !== "/api/cms/slide-audio") return null;
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const variant = String(env?.APP_VARIANT || "").trim();
  if (!speechReady(env, variant)) return json({ message: "Speech TTS is not configured for this app variant." }, 400);

  const input = await readJson(request);
  const fallbackLang = langCode(input.speakLangCode);
  const items = (Array.isArray(input.items) ? input.items : [])
    .map((raw, index) => ({
      key: String(raw?.key ?? index),
      text: String(raw?.text || "").trim().slice(0, MAX_TEXT),
      speakLangCode: langCode(raw?.speakLangCode || fallbackLang),
    }))
    .filter((item) => item.text)
    .slice(0, MAX_SLIDES);
  if (!items.length) return json({ message: "There is no slide text to read aloud." }, 400);

  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await makeClip(env, items[index], variant);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  return json({
    results,
    generated: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
  });
}

async function makeClip(env, item, variant) {
  try {
    const audio = await speak(env, item.text, { language: item.speakLangCode, purpose: "question", variant });
    const bytes = base64Bytes(audio.audioContent);
    const url = uploadUrl("slides", `slide-${Date.now()}-${randomPart(8)}.mp3`);
    await storeUpload(env, url, bytes, { contentType: "audio/mpeg" });
    return { key: item.key, ok: true, url };
  } catch (error) {
    return { key: item.key, ok: false, error: error instanceof Error ? error.message : "Speech failed." };
  }
}

function langCode(value) {
  return String(value || "en").trim().toLowerCase() || "en";
}

function base64Bytes(value) {
  const binary = atob(String(value || "").trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (!bytes.length) throw new Error("Speech synthesis returned no audio.");
  return bytes;
}
