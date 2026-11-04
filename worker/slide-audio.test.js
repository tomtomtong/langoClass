import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { uploadKey } from "./uploads.js";
import { api, developerToken, memoryD1, memoryR2 } from "./test-env.js";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

async function setup(extra = {}) {
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), INWORLD_API_KEY: "k", ORIGIN: "https://classroom.lango.ai", ...extra };
  const token = await developerToken(handleStoreApi, env);
  return { env, call: api(handleStoreApi, env, token) };
}

function inworld() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.inworld\.ai\//);
    calls.push(JSON.parse(init.body));
    return Response.json({ audioContent: btoa("ID3-slide-audio") });
  };
  return calls;
}

test("each slide's text becomes an mp3 upload under /uploads/slides", async () => {
  const { env, call } = await setup();
  const calls = inworld();
  const res = await call("/api/cms/slide-audio", {
    method: "POST",
    json: { speakLangCode: "en", items: [{ key: 0, text: "Say hello." }, { key: 1, text: "Say goodbye." }, { key: 2, text: "   " }] },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.generated, 2);
  assert.equal(body.failed, 0);
  assert.equal(calls.length, 2, "an empty slide is not sent for speech");
  for (const result of body.results) {
    assert.equal(result.ok, true);
    assert.match(result.url, /^\/uploads\/slides\/slide-[\w-]+\.mp3$/);
    const stored = await env.UPLOADS.get(uploadKey(result.url));
    assert.ok(stored, `${result.url} should be in R2`);
  }
  assert.notEqual(body.results[0].url, body.results[1].url);
});

test("a slide whose speech fails is reported, and the others still get a voice", async () => {
  const { call } = await setup();
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    if (n === 1) return new Response("boom", { status: 500 });
    return Response.json({ audioContent: btoa("ID3-ok") });
  };
  const body = await (await call("/api/cms/slide-audio", { method: "POST", json: { items: [{ key: "a", text: "One" }, { key: "b", text: "Two" }] } })).json();
  assert.equal(body.generated + body.failed, 2);
  assert.equal(body.failed, 1);
  assert.equal(body.results.find((r) => !r.ok).error.length > 0, true);
});

test("nothing to read, or no speech provider, is a clear 400", async () => {
  const { call } = await setup();
  const empty = await call("/api/cms/slide-audio", { method: "POST", json: { items: [{ text: "" }] } });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).message, /no slide text/i);

  const off = await setup({ GAMEPLAY_TTS_PROVIDER: "openrouter" });
  const res = await off.call("/api/cms/slide-audio", { method: "POST", json: { items: [{ text: "Hi" }] } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /not configured/i);
});

test("only a signed-in teacher can make voices", async () => {
  const { env } = await setup();
  const res = await handleStoreApi(
    new Request("https://class.lango.ai/api/cms/slide-audio", { method: "POST", body: JSON.stringify({ items: [{ text: "Hi" }] }), headers: { "content-type": "application/json" } }),
    env,
    new URL("https://class.lango.ai/api/cms/slide-audio")
  );
  assert.ok(res.status === 401 || res.status === 403, `got ${res.status}`);
});
