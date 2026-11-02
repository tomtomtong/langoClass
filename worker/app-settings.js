// Admin settings saved from the Config page (/api/config*). They live in the
// D1 app-settings document, as data/app-settings.json did on Node, and a saved
// value wins over the Worker's own variable of the same meaning.
import { completeText, speak, speechProvider, transcribe } from "./ai.js";
import { writeLog } from "./app-logs.js";
import { json, readDoc, readJson, requireTeacher, writeDoc } from "./d1-store.js";

const DOC = "app-settings";
const CACHE_MS = 10000;
const INWORLD_API_BASE = "https://api.inworld.ai";
const QWEN_API_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const INWORLD_TTS_MODEL = "inworld-tts-1.5-max";
const INWORLD_TTS_VOICE = "uncle_tommy";
const OPENROUTER_TTS_VOICE = "eve";
const TEST_PROMPT = [{ role: "user", content: "Reply with exactly: OK" }];

// Saved setting -> the Worker variable it stands in for.
const ENV_NAMES = {
  publicBaseUrl: "PUBLIC_BASE_URL",
  inworldApiKey: "INWORLD_API_KEY",
  inworldLlmModel: "INWORLD_LLM_MODEL",
  inworldSttModel: "INWORLD_STT_MODEL",
  inworldSttLanguage: "INWORLD_STT_LANGUAGE",
  qwenApiKey: "QWEN_API_KEY",
  qwenModel: "QWEN_MODEL",
  azureApiKey: "AZURE_OPENAI_API_KEY",
  azureEndpoint: "AZURE_OPENAI_ENDPOINT",
  azureDeployment: "AZURE_OPENAI_DEPLOYMENT",
  azureApiVersion: "AZURE_OPENAI_API_VERSION",
  openrouterApiKey: "OPENROUTER_API_KEY",
  openrouterBuzzinModel: "OPENROUTER_BUZZIN_MODEL",
  openrouterGenerateModel: "OPENROUTER_GENERATE_MODEL",
  openrouterVisionModel: "OPENROUTER_VISION_MODEL",
  openrouterTtsModel: "OPENROUTER_TTS_MODEL",
  gameplayTtsProvider: "GAMEPLAY_TTS_PROVIDER",
  elevenlabsVoiceId: "ELEVENLABS_VOICE_ID",
  elevenlabsStability: "ELEVENLABS_STABILITY",
  videoGeneratorApiUrl: "VIDEO_GENERATOR_API_URL",
};

// What the page shows when neither a saved value nor a Worker variable is set;
// these match the defaults in worker/ai.js and server.js.
const DEFAULTS = {
  PUBLIC_BASE_URL: "https://class.lango.ai",
  INWORLD_LLM_MODEL: "auto",
  INWORLD_STT_MODEL: "inworld/inworld-stt-1",
  INWORLD_STT_LANGUAGE: "en-US",
  QWEN_MODEL: "qwen-plus",
  AZURE_OPENAI_API_VERSION: "2024-08-01-preview",
  OPENROUTER_BUZZIN_MODEL: "mistralai/voxtral-small-24b-2507",
  OPENROUTER_GENERATE_MODEL: "x-ai/grok-4.3",
  OPENROUTER_VISION_MODEL: "google/gemini-2.5-flash",
  OPENROUTER_TTS_MODEL: "x-ai/grok-voice-tts-1.0",
  VIDEO_GENERATOR_API_URL: "https://newcms.lango.ai",
};

const TEXT_FIELDS = Object.keys(ENV_NAMES).filter(
  (name) => !["publicBaseUrl", "gameplayTtsProvider", "elevenlabsVoiceId", "elevenlabsStability"].includes(name)
);

let cached = null;

// The Worker env with saved settings laid over it. Bindings (DB, UPLOADS, ...)
// stay reachable through the prototype.
export async function withSettings(env) {
  if (!env?.DB) return env;
  const settings = await savedSettings(env);
  const overrides = {};
  for (const [name, envName] of Object.entries(ENV_NAMES)) {
    const value = settings[name];
    if (value === undefined || value === null || value === "") continue;
    overrides[envName] = String(value);
  }
  return Object.keys(overrides).length ? Object.assign(Object.create(env), overrides) : env;
}

export function forgetSettings() {
  cached = null;
}

export async function handleConfigApi(request, env, url) {
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "/api/config" && !pathname.startsWith("/api/config/")) return null;
  if (!env.DB) return null;
  const method = request.method.toUpperCase();

  if (pathname === "/api/config" && method === "GET") return json(await configResponse(env));
  if (pathname === "/api/config" && method === "PUT") return saveConfig(request, env);
  if (method !== "POST") return null;

  const test = {
    "/api/config/test-gameplay-tts": testGameplayTts,
    "/api/config/test-inworld": testInworld,
    "/api/config/test-qwen": testQwen,
    "/api/config/test-azure": testAzure,
    "/api/config/test-openrouter": testOpenRouter,
    "/api/config/clear-student-database": clearStudentDatabase,
  }[pathname];
  if (!test) return null;
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  return test(request, env, auth);
}

async function savedSettings(env) {
  if (cached && cached.expires > Date.now()) return cached.settings;
  const settings = await readDoc(env, DOC, {});
  cached = { settings, expires: Date.now() + CACHE_MS };
  return settings;
}

async function saveConfig(request, env) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const body = await readJson(request);
  const updates = {};

  if (body.publicBaseUrl !== undefined) {
    const text = String(body.publicBaseUrl || "").trim().replace(/\/$/, "");
    if (text) {
      let parsed;
      try {
        parsed = new URL(text);
      } catch {
        return json({ message: "Invalid URL." }, 400);
      }
      if (!/^https?:$/.test(parsed.protocol)) return json({ message: "URL must start with http:// or https://" }, 400);
    }
    updates.publicBaseUrl = text;
  }
  for (const name of TEXT_FIELDS) {
    if (body[name] === undefined) continue;
    let value = String(body[name] || "").trim();
    if (name === "azureEndpoint") value = value.replace(/\/$/, "");
    updates[name] = value;
  }
  if (body.gameplayTtsProvider !== undefined) {
    if (!["", "inworld", "openrouter", "elevenlabs"].includes(body.gameplayTtsProvider)) {
      return json({ message: "Invalid TTS provider." }, 400);
    }
    updates.gameplayTtsProvider = body.gameplayTtsProvider;
  }
  if (body.elevenlabsVoiceId !== undefined) {
    const voice = body.elevenlabsVoiceId;
    if (typeof voice !== "string" || (voice.trim() && !/^[A-Za-z0-9_-]{1,128}$/.test(voice.trim()))) {
      return json({ message: "Invalid ElevenLabs Voice ID." }, 400);
    }
    updates.elevenlabsVoiceId = voice.trim();
  }
  if (body.elevenlabsStability !== undefined) {
    const stability = body.elevenlabsStability;
    if (typeof stability !== "number" || !Number.isFinite(stability) || stability < 0 || stability > 1) {
      return json({ message: "Stability must be a number between 0 and 1." }, 400);
    }
    updates.elevenlabsStability = stability;
  }
  if (!Object.keys(updates).length) return json({ message: "No settings to update." }, 400);

  const settings = { ...(await readDoc(env, DOC, {})), ...updates };
  await writeDoc(env, DOC, settings);
  forgetSettings();
  await writeLog(env, {
    category: "server",
    action: "config_saved",
    message: `Settings saved: ${Object.keys(updates).join(", ")}`,
    meta: { teacherId: auth.teacherId, fields: Object.keys(updates) },
  });
  return json({ ok: true, ...(await configResponse(env)) });
}

async function configResponse(env) {
  const settings = await savedSettings(env);
  const effective = await withSettings(env);
  const fromEnv = (name) => String(env[name] || "").trim();
  const envDefault = (name) => fromEnv(name) || DEFAULTS[name] || "";
  const current = (name) => String(effective[name] || "").trim() || DEFAULTS[name] || "";
  const key = (field, envName) => {
    const value = String(effective[envName] || "").trim();
    return {
      [`${field}Saved`]: Boolean(settings[field]),
      [`${field}Configured`]: Boolean(value),
      [`${field}Masked`]: maskKey(value),
    };
  };
  const provider = speechProvider(effective);
  const azureConfigured = Boolean(current("AZURE_OPENAI_API_KEY") && current("AZURE_OPENAI_ENDPOINT") && current("AZURE_OPENAI_DEPLOYMENT"));

  return {
    publicBaseUrl: settings.publicBaseUrl || "",
    envDefault: envDefault("PUBLIC_BASE_URL"),
    effectivePublicBaseUrl: current("PUBLIC_BASE_URL"),
    ...key("inworldApiKey", "INWORLD_API_KEY"),
    inworldEnvDefaultConfigured: Boolean(fromEnv("INWORLD_API_KEY")),
    inworldLlmModelSaved: settings.inworldLlmModel || "",
    inworldLlmModelEnvDefault: envDefault("INWORLD_LLM_MODEL"),
    effectiveInworldLlmModel: current("INWORLD_LLM_MODEL"),
    inworldSttModelSaved: settings.inworldSttModel || "",
    inworldSttModelEnvDefault: envDefault("INWORLD_STT_MODEL"),
    effectiveInworldSttModel: current("INWORLD_STT_MODEL"),
    inworldSttLanguageSaved: settings.inworldSttLanguage || "",
    inworldSttLanguageEnvDefault: envDefault("INWORLD_STT_LANGUAGE"),
    effectiveInworldSttLanguage: current("INWORLD_STT_LANGUAGE"),
    ...key("qwenApiKey", "QWEN_API_KEY"),
    qwenEnvDefaultConfigured: Boolean(fromEnv("QWEN_API_KEY")),
    qwenModelSaved: settings.qwenModel || "",
    qwenModelEnvDefault: envDefault("QWEN_MODEL"),
    effectiveQwenModel: current("QWEN_MODEL"),
    ...key("azureApiKey", "AZURE_OPENAI_API_KEY"),
    azureEnvDefaultConfigured: Boolean(fromEnv("AZURE_OPENAI_API_KEY")),
    azureEndpointSaved: settings.azureEndpoint || "",
    azureEndpointEnvDefault: envDefault("AZURE_OPENAI_ENDPOINT"),
    effectiveAzureEndpoint: current("AZURE_OPENAI_ENDPOINT"),
    azureDeploymentSaved: settings.azureDeployment || "",
    azureDeploymentEnvDefault: envDefault("AZURE_OPENAI_DEPLOYMENT"),
    effectiveAzureDeployment: current("AZURE_OPENAI_DEPLOYMENT"),
    azureApiVersionSaved: settings.azureApiVersion || "",
    azureApiVersionEnvDefault: envDefault("AZURE_OPENAI_API_VERSION"),
    effectiveAzureApiVersion: current("AZURE_OPENAI_API_VERSION"),
    azureConfigured,
    ...key("openrouterApiKey", "OPENROUTER_API_KEY"),
    openrouterEnvDefaultConfigured: Boolean(fromEnv("OPENROUTER_API_KEY")),
    openrouterBuzzinModelSaved: settings.openrouterBuzzinModel || "",
    openrouterBuzzinModelEnvDefault: envDefault("OPENROUTER_BUZZIN_MODEL"),
    effectiveOpenRouterBuzzinModel: current("OPENROUTER_BUZZIN_MODEL"),
    openrouterGenerateModelSaved: settings.openrouterGenerateModel || "",
    openrouterGenerateModelEnvDefault: envDefault("OPENROUTER_GENERATE_MODEL"),
    effectiveOpenRouterGenerateModel: current("OPENROUTER_GENERATE_MODEL"),
    openrouterVisionModelSaved: settings.openrouterVisionModel || "",
    openrouterVisionModelEnvDefault: envDefault("OPENROUTER_VISION_MODEL"),
    effectiveOpenRouterVisionModel: current("OPENROUTER_VISION_MODEL"),
    openrouterTtsModelSaved: settings.openrouterTtsModel || "",
    openrouterTtsModelEnvDefault: envDefault("OPENROUTER_TTS_MODEL"),
    effectiveOpenRouterTtsModel: current("OPENROUTER_TTS_MODEL"),
    gameplayTtsProvider: settings.gameplayTtsProvider || "",
    effectiveGameplayTtsProvider: provider,
    elevenlabsVoiceId: settings.elevenlabsVoiceId || "",
    elevenlabsStability: typeof settings.elevenlabsStability === "number" ? settings.elevenlabsStability : 0.5,
    ttsRouting: ttsRouting(effective, provider, settings),
    videoGeneratorApiUrlSaved: settings.videoGeneratorApiUrl || "",
    videoGeneratorApiUrlEnvDefault: envDefault("VIDEO_GENERATOR_API_URL"),
    effectiveVideoGeneratorApiUrl: current("VIDEO_GENERATOR_API_URL"),
    studentDatabase: await studentDatabaseStats(env),
  };
}

function ttsRouting(effective, provider, settings) {
  const openRouterModel = String(effective.OPENROUTER_TTS_MODEL || "").trim() || DEFAULTS.OPENROUTER_TTS_MODEL;
  const current =
    provider === "elevenlabs"
      ? { provider: "elevenlabs", model: "eleven_multilingual_v2", voice: settings.elevenlabsVoiceId || "", stability: settings.elevenlabsStability ?? 0.5 }
      : provider === "openrouter"
        ? { provider: "openrouter", model: openRouterModel, voice: OPENROUTER_TTS_VOICE }
        : { provider: "inworld", model: INWORLD_TTS_MODEL, voice: INWORLD_TTS_VOICE };
  return {
    classroom: { app: "Classroom (main)", provider: "Inworld", model: INWORLD_TTS_MODEL, voice: INWORLD_TTS_VOICE },
    elderly: { app: "HK Elderly", provider: "OpenRouter", model: openRouterModel, voice: OPENROUTER_TTS_VOICE },
    current,
    currentVariant: "classroom",
  };
}

async function testGameplayTts(_request, env) {
  const effective = await withSettings(env);
  const started = Date.now();
  try {
    const audio = await speak(effective, "Hello from Lango.", { language: "en" });
    return json({ ok: true, ...audio, provider: speechProvider(effective), latencyMs: Date.now() - started });
  } catch (error) {
    return json({ message: errorText(error, "Speech test failed.") }, 502);
  }
}

async function testInworld(request, env) {
  const body = await readJson(request);
  const effective = await withSettings(env);
  const key = picked(body.inworldApiKey, effective.INWORLD_API_KEY);
  const model = picked(body.inworldLlmModel, effective.INWORLD_LLM_MODEL) || DEFAULTS.INWORLD_LLM_MODEL;
  if (!key) return json({ message: "No Inworld API key to test. Enter a key or set INWORLD_API_KEY." }, 400);
  const withKey = Object.assign(Object.create(effective), { INWORLD_API_KEY: key, GAMEPLAY_TTS_PROVIDER: "inworld" });
  const started = Date.now();
  try {
    const [tts, llm, stt] = await Promise.all([
      timed(async () => {
        const sample = await speak(withKey, "Inworld TTS is working.", { language: "en" });
        return { voiceId: INWORLD_TTS_VOICE, modelId: INWORLD_TTS_MODEL, audioBytes: base64Bytes(sample.audioContent), format: sample.format };
      }),
      timed(async () => ({
        model,
        reply: (await chat(`${INWORLD_API_BASE}/v1/chat/completions`, `Basic ${key}`, model, "Inworld")).slice(0, 200),
        usage: null,
      })),
      timed(async () => {
        const sample = await speak(withKey, "Buzz In speech to text test.", { language: "en" });
        const transcript = await transcribe(withKey, { audioBase64: sample.audioContent, format: sample.format, language: "en" });
        return {
          modelId: String(effective.INWORLD_STT_MODEL || "").trim() || DEFAULTS.INWORLD_STT_MODEL,
          language: String(effective.INWORLD_STT_LANGUAGE || "").trim() || DEFAULTS.INWORLD_STT_LANGUAGE,
          transcript: String(transcript || "").slice(0, 200),
        };
      }),
    ]);
    return json({ ok: true, latencyMs: Date.now() - started, tts, llm, stt });
  } catch (error) {
    return json({ message: errorText(error, "Inworld API test failed.") }, 400);
  }
}

async function testQwen(request, env) {
  const body = await readJson(request);
  const effective = await withSettings(env);
  const key = picked(body.qwenApiKey, effective.QWEN_API_KEY);
  const model = picked(body.qwenModel, effective.QWEN_MODEL) || DEFAULTS.QWEN_MODEL;
  if (!key) return json({ message: "No Qwen API key to test. Enter a key or set QWEN_API_KEY." }, 400);
  const started = Date.now();
  try {
    const llm = await timed(async () => ({
      model,
      reply: (await chat(`${QWEN_API_BASE}/chat/completions`, `Bearer ${key}`, model, "Qwen")).slice(0, 200),
      usage: null,
    }));
    return json({ ok: true, latencyMs: Date.now() - started, llm });
  } catch (error) {
    return json({ message: errorText(error, "Qwen API test failed.") }, 400);
  }
}

async function testAzure(request, env) {
  const body = await readJson(request);
  const effective = await withSettings(env);
  const key = picked(body.azureApiKey, effective.AZURE_OPENAI_API_KEY);
  const endpoint = picked(body.azureEndpoint, effective.AZURE_OPENAI_ENDPOINT).replace(/\/$/, "");
  const deployment = picked(body.azureDeployment, effective.AZURE_OPENAI_DEPLOYMENT);
  const apiVersion = picked(body.azureApiVersion, effective.AZURE_OPENAI_API_VERSION) || DEFAULTS.AZURE_OPENAI_API_VERSION;
  if (!key) return json({ message: "No Azure API key to test. Enter a key or set AZURE_OPENAI_API_KEY." }, 400);
  if (!endpoint) return json({ message: "Azure endpoint is required (e.g. https://your-resource.openai.azure.com)." }, 400);
  if (!deployment) return json({ message: "Azure deployment name is required." }, 400);
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const started = Date.now();
  try {
    const llm = await timed(async () => ({
      deployment,
      endpoint,
      apiVersion,
      reply: (await chat(url, null, null, "Azure OpenAI", { "api-key": key })).slice(0, 200),
    }));
    return json({ ok: true, latencyMs: Date.now() - started, llm });
  } catch (error) {
    return json({ message: errorText(error, "Azure OpenAI test failed.") }, 400);
  }
}

async function testOpenRouter(request, env) {
  const body = await readJson(request);
  const effective = await withSettings(env);
  const key = picked(body.openrouterApiKey, effective.OPENROUTER_API_KEY);
  const model = picked(body.openrouterBuzzinModel, effective.OPENROUTER_BUZZIN_MODEL) || DEFAULTS.OPENROUTER_BUZZIN_MODEL;
  if (!key) return json({ message: "OpenRouter is not configured. Add an API key in Config." }, 400);
  const started = Date.now();
  try {
    const reply = await completeText(Object.assign(Object.create(effective), { OPENROUTER_API_KEY: key }), TEST_PROMPT, 16, { model });
    return json({ ok: true, model, latencyMs: Date.now() - started, reply: String(reply || "").slice(0, 200) });
  } catch (error) {
    return json({ message: errorText(error, "OpenRouter API test failed.") }, 400);
  }
}

// Clears every school's scores, as the Node button did: the student-scores
// document and the score_records rows rooms write.
async function clearStudentDatabase(_request, env, auth) {
  const before = await studentDatabaseStats(env);
  await writeDoc(env, "student-scores", { students: {}, records: [] });
  try {
    await env.DB.prepare("DELETE FROM score_records").run();
  } catch (error) {
    if (!/no such table/i.test(errorText(error, ""))) throw error;
  }
  await writeLog(env, {
    category: "student",
    action: "student_database_cleared",
    message: `Cleared ${before.recordCount} score record(s) for ${before.studentCount} student(s)`,
    level: "warn",
    meta: { teacherId: auth.teacherId, ...before },
  });
  return json({
    ok: true,
    cleared: { students: before.studentCount, records: before.recordCount },
    studentDatabase: await studentDatabaseStats(env),
  });
}

async function studentDatabaseStats(env) {
  const legacy = await readDoc(env, "student-scores", { students: {}, records: [] });
  const students = new Set(Object.keys(legacy.students || {}));
  let recordCount = Array.isArray(legacy.records) ? legacy.records.length : 0;
  try {
    const { results } = await env.DB.prepare(
      "SELECT teacher_id, class_id, json_extract(body, '$.studentUserId') AS student FROM score_records"
    ).all();
    for (const row of results || []) {
      recordCount += 1;
      students.add(`${row.teacher_id}:${row.class_id}:${row.student}`);
    }
  } catch (error) {
    if (!/no such table/i.test(errorText(error, ""))) throw error;
  }
  return { studentCount: students.size, recordCount };
}

async function chat(url, authorization, model, label, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (authorization) headers.Authorization = authorization;
  const body = { messages: TEST_PROMPT, max_tokens: 16 };
  if (model) body.model = model;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || (typeof data?.error === "string" ? data.error : "");
    throw new Error(message || `${label} API returned ${response.status}.`);
  }
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

async function timed(run) {
  const started = Date.now();
  const result = await run();
  return { ok: true, latencyMs: Date.now() - started, ...result };
}

function picked(fromBody, fallback) {
  const text = fromBody == null ? "" : String(fromBody).trim();
  return text || String(fallback || "").trim();
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `••••${key.slice(-4)}`;
}

function base64Bytes(base64) {
  const text = String(base64 || "").replace(/=+$/, "");
  return Math.floor((text.length * 3) / 4);
}

function errorText(error, fallback) {
  return (error instanceof Error ? error.message : String(error || "")) || fallback;
}
