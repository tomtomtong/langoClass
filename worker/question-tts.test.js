import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { api, developerToken, memoryD1, memoryR2 } from "./test-env.js";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

async function setup() {
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), INWORLD_API_KEY: "k", ORIGIN: "https://classroom.lango.ai" };
  const token = await developerToken(handleStoreApi, env);
  return { env, call: api(handleStoreApi, env, token) };
}

// Inworld answers every synthesis with the same short MP3 payload.
function inworld() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("classroom.lango.ai")) throw new Error(`Called the old server: ${target}`);
    assert.match(target, /^https:\/\/api\.inworld\.ai\//);
    calls.push(JSON.parse(init.body));
    return Response.json({ audioContent: btoa("ID3-audio") });
  };
  return calls;
}

test("prefetch makes each new line once, caches it in R2, and serves it back", async () => {
  const { env, call } = await setup();
  const calls = inworld();
  const items = [
    { key: "0:0", text: "What colour is the sky?" },
    { key: "0:1", text: "What colour is the sky?" },
    { key: "0:2", text: "Name a farm animal.", purpose: "topic" },
  ];
  const first = await (await call("/api/cms/prefetch-question-tts", { method: "POST", json: { items, speakLangCode: "en" } })).json();
  assert.equal(first.generated, 2, JSON.stringify(first));
  assert.equal(first.cached, 0);
  assert.equal(first.results.length, 2);
  assert.equal(calls.length, 2);
  const cacheKey = first.results[0].cacheKey;
  assert.match(cacheKey, /^[a-f0-9]{64}$/);

  const again = await (await call("/api/cms/prefetch-question-tts", { method: "POST", json: { items } })).json();
  assert.equal(again.cached, 2);
  assert.equal(calls.length, 2);

  const forced = await (await call("/api/cms/prefetch-question-tts", { method: "POST", json: { items: [{ ...items[0], force: true }] } })).json();
  assert.equal(forced.results[0].regenerated, true);
  assert.equal(calls.length, 3);

  const audio = await call(`/api/cms/question-tts/${cacheKey}.mp3?v=1`);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get("content-type"), "audio/mpeg");
  assert.equal(await audio.text(), "ID3-audio");
});

test("a failed line is reported without failing the batch", async () => {
  const { call } = await setup();
  let count = 0;
  globalThis.fetch = async () => {
    count += 1;
    if (count === 1) return Response.json({ error: { message: "quota" } }, { status: 429 });
    return Response.json({ audioContent: btoa("ok") });
  };
  const body = await (
    await call("/api/cms/prefetch-question-tts", { method: "POST", json: { items: [{ key: "a", text: "One" }, { key: "b", text: "Two" }] } })
  ).json();
  assert.equal(body.failed, 1, JSON.stringify(body));
  assert.equal(body.generated, 1);
});

test("audio ids are checked and missing audio is a 404", async () => {
  const { call } = await setup();
  assert.equal((await call("/api/cms/question-tts/not-a-key")).status, 400);
  assert.equal((await call(`/api/cms/question-tts/${"a".repeat(64)}.mp3`)).status, 404);
});

test("prefetch needs a teacher login", async () => {
  const { env } = await setup();
  globalThis.fetch = async () => new Response("no", { status: 401 });
  const response = await api(handleStoreApi, env, "bad-token")("/api/cms/prefetch-question-tts", {
    method: "POST",
    headers: { "x-teacher-id": "5" },
    json: { items: [{ text: "Hi" }] },
  });
  assert.equal(response.status, 401);
});
