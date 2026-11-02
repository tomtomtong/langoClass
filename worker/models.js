// POST /llm, /tts and /stt, answered by the providers in ai.js with the
// Worker's own keys. exercise-generator.js is not used here.
import { completeText, speak, transcribe } from "./ai.js";

const MODEL_PATHS = new Map([
  ["/llm", "llm"],
  ["/api/llm", "llm"],
  ["/tts", "tts"],
  ["/api/tts", "tts"],
  ["/stt", "stt"],
  ["/api/stt", "stt"],
]);

const AUDIO_TYPES = {
  wav: "audio/wav",
  webm: "audio/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export function modelKind(pathname) {
  return MODEL_PATHS.get(pathname) || "";
}

export async function handleModelRequest(request, env, url) {
  const kind = modelKind(url.pathname);
  if (!kind) return null;
  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Send a JSON body." }, 400);
  }

  let prepared;
  try {
    prepared = prepareModelBody(kind, body);
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "Invalid model request." }, 400);
  }

  try {
    if (kind === "llm") {
      const text = String(await completeText(env, prepared.messages, prepared.maxTokens)).trim();
      if (!text) return json({ message: "Model request failed." }, 502);
      return json({ ok: true, text }, 200);
    }
    if (kind === "tts") {
      const audio = await speak(env, prepared.text, { language: prepared.language, variant: env?.APP_VARIANT });
      return json({ ok: true, audioContent: audio.audioContent, format: audio.format || "mp3" }, 200);
    }
    return json({ ok: true, text: await requestSpeechText(env, prepared) }, 200);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "model_request_failed",
        kind,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return json({ message: error instanceof Error ? error.message : "Model request failed." }, 502);
  }
}

export async function requestSpeechText(env, data) {
  const prepared = prepareModelBody("stt", data || {});
  const text = String(await transcribe(env, prepared)).trim();
  if (!text) throw new Error("Transcription failed.");
  return text;
}

function prepareModelBody(kind, body) {
  if (kind === "llm") {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const prepared = [];
    for (const message of messages.slice(0, 16)) {
      if (message?.content != null && typeof message.content !== "string") {
        throw new Error("Send text messages.");
      }
      const role = message?.role === "assistant" || message?.role === "system" ? message.role : "user";
      const content = String(message?.content || "").trim().slice(0, 8000);
      if (content) prepared.push({ role, content });
    }
    if (!prepared.some((message) => message.role === "user")) {
      throw new Error("Enter a message for the model.");
    }
    const requested = Number(body?.maxTokens);
    const maxTokens = Math.min(4096, Math.max(1, Number.isFinite(requested) && requested > 0 ? requested : 1024));
    return { messages: prepared, maxTokens };
  }
  if (kind === "tts") {
    const text = String(body?.text || "").trim().slice(0, 2000);
    if (!text) throw new Error("No text to synthesize.");
    const language = String(body?.language || "en").trim().slice(0, 16) || "en";
    return { text, language };
  }
  const audioBase64 = String(body?.audioBase64 || "").trim();
  if (!audioBase64) throw new Error("Choose an audio file first.");
  if (audioBase64.length > 12_000_000) throw new Error("Recording is too long. Try a shorter answer.");
  const format = String(body?.format || "wav").trim().toLowerCase().replace(/^\./, "").slice(0, 16) || "wav";
  if (!AUDIO_TYPES[format]) throw new Error("Unsupported audio format.");
  const language = String(body?.language || "").trim().slice(0, 16);
  return { audioBase64, format, ...(language ? { language } : {}) };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-model-runtime": "worker" },
  });
}

