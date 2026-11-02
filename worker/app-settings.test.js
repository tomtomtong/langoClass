import assert from "node:assert/strict";
import test from "node:test";
import { forgetSettings, handleConfigApi, withSettings } from "./app-settings.js";
import { handleStoreApi } from "./d1-api.js";
import { api, developerToken, getDoc, memoryD1, putDoc } from "./test-env.js";

async function setup(extra = {}) {
  forgetSettings();
  const env = { DB: memoryD1(), CMS_API_BASE: "https://cms.test", ...extra };
  const token = await developerToken(handleStoreApi, env);
  return { env, call: api(handleConfigApi, env, token) };
}

async function withFetch(respond, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test("saved settings win over the Worker's variables and keep its bindings", async () => {
  const { env } = await setup({ OPENROUTER_GENERATE_MODEL: "env/model" });
  await putDoc(env, "app-settings", { openrouterGenerateModel: "", gameplayTtsProvider: "elevenlabs", publicBaseUrl: "https://x.test" });
  const effective = await withSettings(env);
  assert.equal(effective.PUBLIC_BASE_URL, "https://x.test");
  assert.equal(effective.OPENROUTER_GENERATE_MODEL, "env/model");
  assert.equal(effective.GAMEPLAY_TTS_PROVIDER, "elevenlabs");
  assert.equal(effective.DB, env.DB);
});

test("keys saved on Node are not used; model calls stay on the router", async () => {
  const { env } = await setup();
  await putDoc(env, "app-settings", { openrouterApiKey: "saved-key", inworldApiKey: "saved-inworld" });
  const effective = await withSettings(env);
  assert.equal(effective.OPENROUTER_API_KEY, undefined);
  assert.equal(effective.INWORLD_API_KEY, undefined);
});

test("config shows masked keys, never the keys themselves", async () => {
  const { env, call } = await setup({ OPENROUTER_API_KEY: "sk-or-v1-abcdefgh1234" });
  await putDoc(env, "app-settings", { openrouterApiKey: "sk-or-v1-saved9999", openrouterVisionModel: "x-ai/grok-4.20" });
  const response = await call("/api/config");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.openrouterApiKeySaved, true);
  assert.equal(body.openrouterApiKeyConfigured, true);
  assert.equal(body.openrouterApiKeyMasked, "••••1234");
  assert.equal(body.inworldApiKeyConfigured, false);
  assert.equal(body.effectiveOpenRouterVisionModel, "x-ai/grok-4.20");
  assert.equal(body.effectiveGameplayTtsProvider, "inworld");
  assert.equal(body.ttsRouting.current.voice, "uncle_tommy");
  assert.deepEqual(body.studentDatabase, { studentCount: 0, recordCount: 0 });
  assert.ok(!JSON.stringify(body).includes("abcdefgh"));
  assert.ok(!JSON.stringify(body).includes("saved9999"));
});

test("saving settings needs a teacher and keeps the other saved values", async () => {
  const { env, call } = await setup();
  await putDoc(env, "app-settings", { openrouterApiKey: "kept" });
  const url = new URL("https://class.lango.ai/api/config");
  const anonymous = await handleConfigApi(new Request(url, { method: "PUT", body: "{}" }), env, url);
  assert.equal(anonymous.status, 401);

  const response = await call("/api/config", { method: "PUT", json: { openrouterGenerateModel: " a/b ", gameplayTtsProvider: "openrouter" } });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.effectiveOpenRouterGenerateModel, "a/b");
  assert.equal(body.effectiveGameplayTtsProvider, "openrouter");
  assert.deepEqual(await getDoc(env, "app-settings"), { openrouterApiKey: "kept", openrouterGenerateModel: "a/b", gameplayTtsProvider: "openrouter" });
  assert.equal((await withSettings(env)).OPENROUTER_GENERATE_MODEL, "a/b");
  const logged = env.DB.raw.prepare("SELECT json_extract(body, '$.action') AS action FROM app_logs").all();
  assert.deepEqual(logged.map((row) => row.action), ["config_saved"]);
});

test("bad settings are refused", async () => {
  const { call } = await setup();
  for (const [field, value] of [
    ["gameplayTtsProvider", "robot"],
    ["elevenlabsStability", 2],
    ["elevenlabsVoiceId", "bad voice!"],
    ["publicBaseUrl", "ftp://x"],
  ]) {
    const response = await call("/api/config", { method: "PUT", json: { [field]: value } });
    assert.equal(response.status, 400, field);
  }
  assert.equal((await call("/api/config", { method: "PUT", json: {} })).status, 400);
});

test("the OpenRouter test uses the typed key and model", async () => {
  const { call } = await setup();
  await withFetch(
    () => Response.json({ choices: [{ message: { content: "OK" } }] }),
    async (calls) => {
      const response = await call("/api/config/test-openrouter", { method: "POST", json: { openrouterApiKey: "typed", openrouterBuzzinModel: "m/one" } });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.reply, "OK");
      assert.equal(body.model, "m/one");
      assert.equal(calls[0].init.headers.Authorization, "Bearer typed");
      assert.equal(JSON.parse(calls[0].init.body).model, "m/one");
    }
  );
});

test("the OpenRouter test without any key says so", async () => {
  const { call } = await setup();
  const response = await call("/api/config/test-openrouter", { method: "POST", json: {} });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /not configured/);
});

test("the Azure test reports the provider's error", async () => {
  const { call } = await setup();
  await withFetch(
    () => Response.json({ error: { message: "Access denied" } }, { status: 401 }),
    async (calls) => {
      const response = await call("/api/config/test-azure", {
        method: "POST",
        json: { azureApiKey: "a", azureEndpoint: "https://r.openai.azure.com/", azureDeployment: "gpt" },
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).message, "Access denied");
      assert.equal(calls[0].url, "https://r.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-08-01-preview");
      assert.equal(calls[0].init.headers["api-key"], "a");
    }
  );
});

test("clearing the student database empties both score stores", async () => {
  const { env, call } = await setup();
  await putDoc(env, "student-scores", { students: { a: {}, b: {} }, records: [{ recordKey: "x" }] });
  env.DB.raw
    .prepare("INSERT INTO score_records (record_key, teacher_id, class_id, saved_at, body) VALUES (?, ?, ?, ?, ?)")
    .run("k1", "835", 62, "2026-11-02T00:00:00Z", JSON.stringify({ studentUserId: "62001" }));
  const response = await call("/api/config/clear-student-database", { method: "POST" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.cleared, { students: 3, records: 2 });
  assert.deepEqual(body.studentDatabase, { studentCount: 0, recordCount: 0 });
  assert.equal(env.DB.raw.prepare("SELECT count(*) AS n FROM score_records").get().n, 0);
});
