// CMS question speech previews, as server.js /api/cms/prefetch-question-tts and
// /api/cms/question-tts/:cacheKey served them. Audio is made by ai.js and kept
// in R2 under question-tts/, outside the public uploads folders.
import { speak, speechProvider, speechReady } from "./ai.js";
import { json, readJson, requireTeacher } from "./d1-store.js";

// Bump when provider, voice or styling changes should drop cached audio.
const CACHE_VERSION = "w1";
const MAX_ITEMS = 200;
const CONCURRENCY = 4;

export async function handleQuestionTtsApi(request, env, url) {
  const method = request.method.toUpperCase();
  if (method === "POST" && url.pathname === "/api/cms/prefetch-question-tts") return prefetch(request, env);
  const audio = url.pathname.match(/^\/api\/cms\/question-tts\/([^/]+)$/);
  if (audio && (method === "GET" || method === "HEAD")) return readAudio(request, env, audio[1]);
  return null;
}

async function prefetch(request, env) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const variant = String(env?.APP_VARIANT || "").trim();
  if (!speechReady(env, variant)) return json({ message: "Speech TTS is not configured for this app variant." }, 400);

  const input = await readJson(request);
  const fallbackLang = langCode(input.speakLangCode);
  const items = dedupe(
    (Array.isArray(input.items) ? input.items : [])
      .map((raw, index) => ({
        key: String(raw?.key ?? index).trim() || String(index),
        text: String(raw?.text || "").trim(),
        speakLangCode: langCode(raw?.speakLangCode || fallbackLang),
        purpose: String(raw?.purpose || "question").trim() || "question",
        force: Boolean(raw?.force),
      }))
      .filter((item) => item.text)
      .slice(0, MAX_ITEMS)
  );

  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await prefetchOne(env, items[index], variant);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  return json({
    results,
    generated: results.filter((entry) => entry.ok && !entry.cached).length,
    cached: results.filter((entry) => entry.ok && entry.cached).length,
    failed: results.filter((entry) => !entry.ok).length,
  });
}

async function prefetchOne(env, item, variant) {
  try {
    const cacheKey = await cacheKeyFor(item, speechProvider(env, variant));
    const objectKey = `question-tts/${cacheKey}.mp3`;
    if (!item.force && (await env.UPLOADS.head(objectKey))) {
      return { key: item.key, ok: true, cacheKey, cached: true, regenerated: false };
    }
    const audio = await speak(env, item.text, { language: item.speakLangCode, purpose: item.purpose, variant });
    await env.UPLOADS.put(objectKey, base64Bytes(audio.audioContent), { httpMetadata: { contentType: "audio/mpeg" } });
    return { key: item.key, ok: true, cacheKey, cached: false, regenerated: item.force };
  } catch (error) {
    return { key: item.key, ok: false, error: error instanceof Error ? error.message : "TTS failed." };
  }
}

// The speech for a question read aloud in a live room. Rooms asking for the same
// line share one clip in R2, and a clip the CMS already prefetched is reused, so
// only the first room to ask pays for the speech model. Storage trouble never
// stops the question: it falls back to making the speech.
export async function speakQuestion(env, text, { language = "en", variant = "" } = {}) {
  const item = { text: String(text || "").trim(), speakLangCode: langCode(language), purpose: "question" };
  let objectKey = null;
  try {
    objectKey = `question-tts/${await cacheKeyFor(item, speechProvider(env, variant))}.mp3`;
    const hit = await env.UPLOADS.get(objectKey);
    if (hit) return { audioContent: bytesBase64(new Uint8Array(await hit.arrayBuffer())), format: "mp3", cached: true };
  } catch (error) {
    console.warn(JSON.stringify({ message: "question_tts_cache_read_failed", error: String(error?.message || error) }));
  }
  const audio = await speak(env, item.text, { language: item.speakLangCode, purpose: item.purpose, variant });
  if (objectKey) {
    try {
      await env.UPLOADS.put(objectKey, base64Bytes(audio.audioContent), { httpMetadata: { contentType: "audio/mpeg" } });
    } catch (error) {
      console.warn(JSON.stringify({ message: "question_tts_cache_write_failed", error: String(error?.message || error) }));
    }
  }
  return audio;
}

async function readAudio(request, env, raw) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const cacheKey = decodeURIComponent(raw).replace(/\.mp3$/i, "").trim();
  if (!/^[a-f0-9]{64}$/i.test(cacheKey)) return json({ message: "Invalid audio id." }, 400);
  const object = await env.UPLOADS.get(`question-tts/${cacheKey.toLowerCase()}.mp3`);
  if (!object) return json({ message: "Speech audio not found." }, 404);
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: { "content-type": "audio/mpeg", "cache-control": "private, no-cache", "content-length": String(object.size) },
  });
}

async function cacheKeyFor(item, provider) {
  const payload = JSON.stringify({
    v: CACHE_VERSION,
    text: item.text,
    speakLangCode: item.speakLangCode,
    purpose: item.purpose,
    provider,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const signature = `${item.purpose}|${item.speakLangCode}|${item.text}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function langCode(value) {
  return String(value || "en").trim().toLowerCase() || "en";
}

function bytesBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64Bytes(value) {
  const binary = atob(String(value || "").trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (!bytes.length) throw new Error("Speech synthesis returned no audio.");
  return bytes;
}
