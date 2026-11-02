import assert from "node:assert/strict";
import test from "node:test";
import { handleModelRequest, modelKind, requestSpeechText } from "./models.js";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(path, body, env) {
  const url = new URL(path, "https://class.lango.ai");
  const request = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return handleModelRequest(request, env, url);
}

function refuseOldServer() {
  globalThis.fetch = async (url) => {
    if (String(url).includes("classroom.lango.ai")) throw new Error(`Called the old server: ${url}`);
    throw new Error(`Unexpected fetch ${url}`);
  };
}

test("model paths cover llm, tts and stt with and without /api", () => {
  assert.equal(modelKind("/api/llm"), "llm");
  assert.equal(modelKind("/tts"), "tts");
  assert.equal(modelKind("/api/stt"), "stt");
  assert.equal(modelKind("/api/other"), "");
});

test("language calls go to OpenRouter with the Worker key, not a client key", async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    sent = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return Response.json({ choices: [{ message: { content: "Hello class" } }] });
  };
  const response = await post(
    "/api/llm",
    { apiKey: "client-key", messages: [{ role: "user", content: "Hi" }], maxTokens: 99999 },
    { OPENROUTER_API_KEY: "worker-key", ORIGIN: "https://classroom.lango.ai" }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, text: "Hello class" });
  assert.equal(response.headers.get("x-model-runtime"), "worker");
  assert.equal(sent.headers.get("authorization"), "Bearer worker-key");
  assert.equal(sent.body.max_tokens, 4096);
  assert.deepEqual(sent.body.messages, [{ role: "user", content: "Hi" }]);
});

test("speech recognition uses Inworld with the Worker key", async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.inworld.ai/stt/v1/transcribe");
    return Response.json({ transcription: { transcript: "apple" } });
  };
  const response = await post("/api/stt", { audioBase64: "UklGRg==", format: "wav", language: "en" }, { INWORLD_API_KEY: "k" });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body, { ok: true, text: "apple" });
});

test("without keys, speech recognition goes to the router instead of the old server", async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://newcms.lango.ai/api/router/transcribe");
    return Response.json({ text: "apple" });
  };
  assert.equal(await requestSpeechText({ ORIGIN: "https://classroom.lango.ai" }, { audioBase64: "UklGRg==", format: "wav" }), "apple");
  const response = await post("/api/stt", { audioBase64: "UklGRg==", format: "wav" }, { ORIGIN: "https://classroom.lango.ai" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, text: "apple" });
});

test("bad bodies are refused before any provider call", async () => {
  refuseOldServer();
  assert.equal((await post("/api/llm", { messages: [] }, {})).status, 400);
  assert.equal((await post("/api/tts", { text: " " }, {})).status, 400);
  assert.equal((await post("/api/stt", { audioBase64: "UklGRg==", format: "exe" }, {})).status, 400);
});
