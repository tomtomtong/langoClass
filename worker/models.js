// The classroom asks the backend for a model result. Keys and prompts stay there.
// exercise-generator.js is not used here.

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
  const origin = String(env?.ORIGIN || "").replace(/\/$/, "");
  if (!origin) return json({ message: "Model backend is not configured." }, 500);

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
    return await callBackend(origin, kind, prepared, forwardedAuth(request));
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "model_request_failed",
        kind,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return json({ message: "Model backend unavailable." }, 502);
  }
}

export async function requestSpeechText(env, data) {
  const origin = String(env?.ORIGIN || "").replace(/\/$/, "");
  if (!origin) throw new Error("Speech backend is not configured.");
  const prepared = prepareModelBody("stt", data || {});
  const response = await callBackend(origin, "stt", prepared, {});
  const payload = await response.json().catch(() => ({}));
  const text = String(payload?.text || "").trim();
  if (!response.ok || !payload?.ok || !text) {
    throw new Error(payload?.message || "Transcription failed.");
  }
  return text;
}

async function callBackend(origin, kind, body, authHeaders) {
  const dedicated = await postJson(`${origin}/api/${kind}`, body, authHeaders);
  if (dedicated.status !== 404 && dedicated.status !== 405) return tagBackend(dedicated);
  if (kind === "stt") return tagBackend(await fallbackStt(origin, body));
  if (kind === "tts") return tagBackend(await fallbackTts(origin, body, authHeaders));
  return tagBackend(await fallbackLlm(origin, body, authHeaders));
}

async function fallbackStt(origin, body) {
  const format = body.format || "wav";
  const bytes = decodeBase64(body.audioBase64);
  const form = new FormData();
  form.append("audio", new File([bytes], `speech.${format}`, { type: AUDIO_TYPES[format] || "application/octet-stream" }));
  return fetch(`${origin}/api/transcribe/audio`, { method: "POST", body: form });
}

async function fallbackTts(origin, body, authHeaders) {
  const prepared = await postJson(
    `${origin}/api/cms/prefetch-question-tts`,
    {
      items: [{ key: "speech", text: body.text, speakLangCode: body.language || "en", purpose: "question" }],
    },
    authHeaders
  );
  if (!prepared.ok) return prepared;
  const payload = await prepared.json().catch(() => ({}));
  const result = Array.isArray(payload.results) ? payload.results[0] : null;
  if (!result?.ok || !result.cacheKey) {
    return json({ message: result?.error || "Speech synthesis failed." }, 400);
  }
  const audio = await fetch(`${origin}/api/cms/question-tts/${encodeURIComponent(result.cacheKey)}`, {
    headers: authHeaders,
  });
  if (!audio.ok) return audio;
  const bytes = new Uint8Array(await audio.arrayBuffer());
  return json({ ok: true, audioContent: bytesToBase64(bytes), format: "mp3" });
}

async function fallbackLlm(origin, body, authHeaders) {
  const messages = body.messages;
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const history = messages.slice(0, messages.lastIndexOf(lastUser)).slice(-8);
  const response = await postJson(
    `${origin}/api/cms/assistant`,
    { message: lastUser.content, history },
    authHeaders
  );
  if (!response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  const text = String(payload.reply || payload.text || "").trim();
  if (!text) return json({ message: payload.message || "Model request failed." }, 400);
  return json({ ok: true, text });
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

function forwardedAuth(request) {
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const teacher = request.headers.get("x-teacher-id");
  if (authorization) headers.set("authorization", authorization);
  if (teacher) headers.set("x-teacher-id", teacher);
  return headers;
}

async function postJson(url, body, authHeaders) {
  const headers = new Headers(authHeaders || {});
  headers.set("content-type", "application/json");
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function tagBackend(response) {
  const headers = new Headers(response.headers);
  headers.set("x-model-runtime", "backend");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-model-runtime": "backend" },
  });
}

function decodeBase64(value) {
  const raw = String(value || "").trim();
  const data = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (!bytes.length) throw new Error("Invalid audio data.");
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
