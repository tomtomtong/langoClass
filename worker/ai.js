// Model calls the Worker makes: text from OpenRouter, speech to text from
// Inworld, and speech from Inworld, OpenRouter or ElevenLabs.
// With a Worker secret (OPENROUTER_API_KEY, INWORLD_API_KEY) the provider is
// called directly; without one the same call goes to the keyless newcms
// router (/api/router/text, /transcribe, /tts, /elevenlabs-tts).
// Defaults match server.js so the room sounds the same as it did on Node.

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const INWORLD_API_BASE = "https://api.inworld.ai";
const DEFAULT_GENERATE_MODEL = "x-ai/grok-4.3";
const DEFAULT_OPENROUTER_TTS_MODEL = "x-ai/grok-voice-tts-1.0";
const DEFAULT_OPENROUTER_TTS_VOICE = "eve";
const DEFAULT_INWORLD_STT_MODEL = "inworld/inworld-stt-1";
// Word timings come from Whisper-style models, not inworld-stt-1 (server.js).
const CAPTION_STT_MODEL = "groq/whisper-large-v3";
const INWORLD_TTS_MODEL = "inworld-tts-1.5-max";
const INWORLD_TTS_VOICE = "default-zylgts2tamenvybeti3z0w__uncle_tommy";
const INWORLD_SPEAKING_RATE = 1.12;
const INWORLD_INSTRUCTION =
  "Speak with warm, happy, excited game-show host energy — smiling, upbeat, and encouraging.";
const GROK_TTS_SPEED = 1.12;
const ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const ELEVENLABS_STABILITY = 0.5;
const STT_SAMPLE_RATE = 16000;
const AUDIO_MAX_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 40000;

const BCP47 = {
  en: "en-US",
  zh: "zh-CN",
  yue: "yue-HK",
  ja: "ja-JP",
  ko: "ko-KR",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hi: "hi-IN",
  id: "id-ID",
  it: "it-IT",
  ru: "ru-RU",
  tr: "tr-TR",
  vi: "vi-VN",
  bn: "bn-BD",
};

// The keyless router is always there behind the Worker's own keys.
export function textModelReady() {
  return true;
}

// timeoutMs lets long CMS generations outlast the classroom's 40 second limit.
export async function completeText(env, messages, maxTokens = 1024, { title = "Lango Classroom", model: chosen, timeoutMs } = {}) {
  const key = secret(env, "OPENROUTER_API_KEY");
  if (!key) return completeTextWithRouter(env, messages, timeoutMs);
  const model = String(chosen || "").trim() || setting(env, "OPENROUTER_GENERATE_MODEL", DEFAULT_GENERATE_MODEL);
  const data = await postJson(`${OPENROUTER_API_BASE}/chat/completions`, {
    headers: openRouterHeaders(env, key, title),
    body: { model, messages, max_tokens: maxTokens },
    label: `LLM (${model})`,
    timeoutMs,
  });
  return messageText(data);
}

// allowEmpty: a silent piece of a longer recording gives "" instead of an error.
export async function transcribe(env, { audioBase64, format, language, allowEmpty = false } = {}) {
  const audio = audioPayload(audioBase64, format);
  const lang = sttLanguage(language);
  // Inworld STT handles Cantonese better than voxtral, so without an Inworld key
  // the router's Inworld STT comes before a saved OpenRouter key.
  const inworld = secret(env, "INWORLD_API_KEY");
  const text = inworld
    ? await transcribeWithInworld(env, inworld, audio, lang)
    : await transcribeWithRouter(env, audio, lang);
  if (!text && !allowEmpty) throw new Error("Could not transcribe your recording. Try again.");
  return text;
}

// For captions: { text, words } where words carry timings when Inworld gives
// them; through the router there are none and the caller spreads the text.
export async function transcribeTimed(env, { audioBase64, format, language } = {}) {
  const audio = audioPayload(audioBase64, format);
  const lang = sttLanguage(language);
  const inworld = secret(env, "INWORLD_API_KEY");
  if (!inworld) return { text: await transcribeWithRouter(env, audio, lang), words: [] };
  const configured = setting(env, "INWORLD_STT_MODEL", DEFAULT_INWORLD_STT_MODEL);
  const model = /whisper|assemblyai|soniox|deepgram/i.test(configured) ? configured : CAPTION_STT_MODEL;
  const data = await inworldTranscription(inworld, audio, lang, model, { includeWordTimestamps: true });
  const words = data?.transcription?.wordTimestamps;
  return { text: String(data?.transcription?.transcript || "").trim(), words: Array.isArray(words) ? words : [] };
}

export function speechProvider(env, variant) {
  const chosen = setting(env, "GAMEPLAY_TTS_PROVIDER", "").toLowerCase();
  if (chosen === "elevenlabs" || chosen === "inworld" || chosen === "openrouter") return chosen;
  // As on Node: the classroom speaks with Inworld unless a provider is chosen;
  // HK Elderly uses OpenRouter when there is a key for it.
  if (variant === "hk-elderly" && secret(env, "OPENROUTER_API_KEY")) return "openrouter";
  return "inworld";
}

export function speechReady(env, variant) {
  const provider = speechProvider(env, variant);
  if (provider === "inworld") return true;
  if (provider === "openrouter") return Boolean(secret(env, "OPENROUTER_API_KEY"));
  return Boolean(elevenLabsEndpoint(env));
}

// Returns { audioContent, format } with base64 MP3 audio.
export async function speak(env, text, { language = "en", purpose = "question", variant = "" } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("No text to synthesize.");
  const code = speakLangCode(language) || "en";
  const spoken = await cantoneseSpeech(env, trimmed, code);
  const provider = speechProvider(env, variant);
  if (provider === "elevenlabs") return speakWithElevenLabs(env, spoken, code);
  if (provider === "openrouter") return speakWithOpenRouter(env, spoken, code, purpose);
  return speakWithInworld(env, spoken, code);
}

export function speakLangCode(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0]
    .slice(0, 8);
  return code || "";
}

export function sttLanguage(value, fallback = "en") {
  const code = speakLangCode(value);
  if (/^[a-z]{2,3}$/.test(code)) return code;
  const backup = speakLangCode(fallback);
  return /^[a-z]{2,3}$/.test(backup) ? backup : "en";
}

async function transcribeWithInworld(env, key, audio, language) {
  const model = setting(env, "INWORLD_STT_MODEL", DEFAULT_INWORLD_STT_MODEL);
  const data = await inworldTranscription(key, audio, language, model);
  return String(data?.transcription?.transcript || "").trim();
}

async function inworldTranscription(key, audio, language, model, extra = {}) {
  const encoding = inworldEncoding(audio.format);
  const config = { modelId: model, audioEncoding: encoding, language, ...extra };
  if (encoding === "LINEAR16") {
    config.sampleRateHertz = STT_SAMPLE_RATE;
    config.numberOfChannels = 1;
  }
  return postJson(`${INWORLD_API_BASE}/stt/v1/transcribe`, {
    headers: { Authorization: `Basic ${key}` },
    body: { transcribeConfig: config, audioData: { content: audio.base64 } },
    label: `Transcription (${model})`,
  });
}

async function speakWithInworld(env, text, code) {
  const key = secret(env, "INWORLD_API_KEY");
  if (!key) return speakWithRouter(env, text, code);
  const data = await postJson(`${INWORLD_API_BASE}/tts/v1/voice`, {
    headers: { Authorization: `Basic ${key}` },
    body: {
      text,
      voiceId: setting(env, "INWORLD_TTS_VOICE", INWORLD_TTS_VOICE),
      modelId: INWORLD_TTS_MODEL,
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000, speakingRate: INWORLD_SPEAKING_RATE },
      instruction: INWORLD_INSTRUCTION,
      language: BCP47[code] || "en-US",
    },
    label: "TTS",
  });
  const audioContent = String(data?.audioContent || "").trim();
  if (!audioContent) throw new Error("TTS: No audio returned.");
  return { audioContent, format: "mp3" };
}

// The router takes one prompt and an optional system message, so the chat
// history is written out as a transcript.
async function completeTextWithRouter(env, messages, timeoutMs) {
  const base = routerBase(env);
  const list = Array.isArray(messages) ? messages : [];
  const system = list
    .filter((message) => message?.role === "system")
    .map((message) => contentText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const turns = list.filter((message) => message?.role !== "system");
  const prompt =
    turns.length === 1
      ? contentText(turns[0].content)
      : turns.map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${contentText(message.content)}`).join("\n\n");
  const data = await postJson(`${base}/text`, {
    body: { prompt, ...(system ? { system } : {}) },
    label: "LLM (router)",
    timeoutMs,
  });
  return String(data?.text || "").trim();
}

async function transcribeWithRouter(env, audio, language) {
  const base = routerBase(env);
  if (audio.format !== "wav" && audio.format !== "mp3") {
    throw new Error("Speech recognition needs a WAV or MP3 recording.");
  }
  const form = new FormData();
  const type = audio.format === "wav" ? "audio/wav" : "audio/mpeg";
  form.append("audio", new File([base64ToBytes(audio.base64)], `speech.${audio.format}`, { type }));
  form.append("language", language);
  const response = await timedFetch(`${base}/transcribe`, { method: "POST", body: form });
  const data = await readJson(response);
  if (!response.ok) throw new Error(`Transcription (router): ${errorMessage(data, response.status)}`);
  return String(data?.text || "").trim();
}

async function speakWithRouter(env, text, code) {
  const base = routerBase(env);
  const data = await postJson(`${base}/tts`, {
    body: {
      text,
      voice: setting(env, "INWORLD_TTS_VOICE", INWORLD_TTS_VOICE),
      model: INWORLD_TTS_MODEL,
      language: BCP47[code] || "en-US",
      audioEncoding: "MP3",
      sampleRate: 24000,
      speakingRate: INWORLD_SPEAKING_RATE,
    },
    label: "TTS (router)",
  });
  const match = typeof data?.audio === "string" && data.audio.match(/^data:audio\/(?:mpeg|mp3);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("TTS (router): No MP3 audio returned.");
  return { audioContent: match[1].replace(/\s/g, ""), format: "mp3" };
}

async function speakWithOpenRouter(env, text, code, purpose) {
  const key = secret(env, "OPENROUTER_API_KEY");
  if (!key) throw new Error("OpenRouter API key not configured.");
  const model = setting(env, "OPENROUTER_TTS_MODEL", DEFAULT_OPENROUTER_TTS_MODEL);
  const response = await timedFetch(`${OPENROUTER_API_BASE}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: grokStyle(text, purpose),
      voice: setting(env, "OPENROUTER_TTS_VOICE", DEFAULT_OPENROUTER_TTS_VOICE),
      response_format: "mp3",
      speed: GROK_TTS_SPEED,
      language: code === "zh" ? "zh" : code,
    }),
  });
  if (!response.ok) {
    const data = await readJson(response);
    throw new Error(`TTS (${model}): ${errorMessage(data, response.status)}`);
  }
  const audioContent = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  if (!audioContent) throw new Error("TTS: No audio returned.");
  return { audioContent, format: "mp3" };
}

async function speakWithElevenLabs(env, text, code) {
  const endpoint = elevenLabsEndpoint(env);
  const stability = Number(setting(env, "ELEVENLABS_STABILITY", String(ELEVENLABS_STABILITY)));
  const data = await postJson(endpoint, {
    body: {
      text,
      voiceId: setting(env, "ELEVENLABS_VOICE_ID", ELEVENLABS_VOICE_ID),
      languageCode: code,
      stability: Number.isFinite(stability) ? stability : ELEVENLABS_STABILITY,
    },
    label: "ElevenLabs TTS",
  });
  const match = typeof data?.audio === "string" && data.audio.match(/^data:audio\/(?:mpeg|mp3);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("ElevenLabs TTS: No MP3 audio returned.");
  return { audioContent: match[1].replace(/\s/g, ""), format: "mp3" };
}

// Quiz lines written in Mandarin wording are read with a Mandarin accent, so
// Cantonese rooms rewrite them first, as server.js prepareTextForGameplayTts does.
async function cantoneseSpeech(env, text, code) {
  if (code !== "yue" || !needsCantonesePrep(text) || !textModelReady(env)) return text;
  try {
    const rewritten = await completeText(
      env,
      [
        {
          role: "system",
          content:
            "Rewrite quiz lines into natural spoken Hong Kong Cantonese for text-to-speech. " +
            "Keep Traditional Chinese characters. Keep meaning and place names accurate. Keep it concise. " +
            "Use spoken Cantonese grammar (e.g. 係, 嘅, 咩, 點樣, 呢個, 嗰個, 冇, 喺). " +
            "Return ONLY the rewritten line with no quotes or explanation.",
        },
        {
          role: "user",
          content:
            "Use spoken Hong Kong Cantonese (廣東話口語), NOT Mandarin (普通話) or mainland written Chinese. " +
            "Prefer: 咩/什麼, 點樣, 呢個, 嗰個, 同, 冇, 喺, 嘅, 佢, 哋, 講/形容, 睇, 鍾意, 細個. " +
            "Avoid mainland Mandarin-only words like 通过, 进行, 以及, 并且, 什么, 这个, 怎样, 描述, 这些, 那些." +
            `\n\nLine:\n${text}`,
        },
      ],
      120
    );
    const cleaned = String(rewritten || "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || text;
  } catch {
    return text;
  }
}

const SIMPLIFIED_CHARS = /[这国们时说会个还问图书长开关听语华现从让给进远东电画产业页风龙马鸟鱼见车无云专两为乐习买卖学对头来发广东门时]/;
const STRONG_MANDARIN =
  /(?:怎样|什么|这个|那个|以及|通过|进行|已经|他们|我们|你们|为什么|如何|是否|并且|但是|关于|其中|应该|认为|实际|目前|描述|社区|连接|追溯到|这些|那些|哪个|哪些|非常|因为|所以|如果|可以|需要|现在|还是|没有)/;
const CANTONESE_PARTICLES = /[嘅咩唔喺噉乜邊個邊度係哋佢睇講]/;
const MANDARIN_PREP =
  /(?:怎样|什么|这个|那个|以及|通过|进行|已经|他们|我们|你们|为什么|如何|是否|并且|但是|关于|其中|应该|认为|实际|目前|描述|社区|连接|追溯到|还是|现在|没有|这些|那些|哪个|哪些)/;

function needsCantonesePrep(text) {
  if (SIMPLIFIED_CHARS.test(text) || STRONG_MANDARIN.test(text)) return true;
  if (CANTONESE_PARTICLES.test(text)) return /描述/.test(text);
  return MANDARIN_PREP.test(text);
}

function grokStyle(text, purpose) {
  if (/<(fast|loud|build-intensity|emphasis|whisper|slow|soft)>/.test(text)) return text;
  let lively = text;
  if (!/[!！?？]$/.test(lively)) {
    lively = /[.。…]$/.test(lively) ? lively.replace(/[.。…]+$/, "!") : purpose === "feedback" ? lively : `${lively}!`;
  }
  if (purpose === "feedback" || purpose === "topic") return `<fast><emphasis>${lively}</emphasis></fast>`;
  return `<fast><loud>${lively}</loud></fast>`;
}

function audioPayload(audioBase64, format) {
  const raw = String(audioBase64 || "").trim();
  if (!raw) throw new Error("Record your answer before submitting.");
  const base64 = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  if (!base64 || /[^A-Za-z0-9+/=\s]/.test(base64)) throw new Error("Invalid audio data.");
  if (Math.floor((base64.replace(/\s/g, "").length * 3) / 4) > AUDIO_MAX_BYTES) {
    throw new Error("Recording is too long. Try a shorter answer.");
  }
  const audioFormat = String(format || "webm").trim().toLowerCase().replace(/^\./, "") || "webm";
  return { base64: base64.replace(/\s/g, ""), format: audioFormat };
}

function inworldEncoding(format) {
  if (format === "wav") return "LINEAR16";
  return { webm: "AUTO_DETECT", mp3: "MP3", m4a: "MP3", ogg: "OGG_OPUS", flac: "FLAC" }[format] || "AUTO_DETECT";
}

function openRouterHeaders(env, key, title) {
  return {
    Authorization: `Bearer ${key}`,
    "HTTP-Referer": setting(env, "PUBLIC_BASE_URL", "https://class.lango.ai"),
    "X-Title": title,
  };
}

function elevenLabsEndpoint(env) {
  return setting(env, "ELEVENLABS_TTS_URL", "") || `${routerBase(env)}/elevenlabs-tts`;
}

function routerBase(env) {
  const cms = String(env?.CMS_API_BASE || "https://newcms.lango.ai").replace(/\/$/, "");
  return `${cms}/api/router`;
}

function contentText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text")
      .map((part) => String(part.text || "").trim())
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

async function postJson(url, { headers = {}, body, label, timeoutMs }) {
  const response = await timedFetch(
    url,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(`${label}: ${errorMessage(data, response.status)}`);
  return data;
}

function timedFetch(url, init, timeoutMs = REQUEST_TIMEOUT_MS) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs || REQUEST_TIMEOUT_MS) });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { message: text || response.statusText };
  }
}

function errorMessage(data, status) {
  const message = data?.error?.message || data?.message || (typeof data?.error === "string" ? data.error : "");
  return message || `API returned ${status}.`;
}

function messageText(data) {
  return contentText(data?.choices?.[0]?.message?.content);
}

function secret(env, name) {
  return String(env?.[name] || "").trim();
}

function setting(env, name, fallback) {
  return String(env?.[name] || "").trim() || fallback;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}
