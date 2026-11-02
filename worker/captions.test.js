import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { api, developerToken, memoryD1, memoryR2 } from "./test-env.js";

const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n";

async function setup() {
  const env = { DB: memoryD1(), UPLOADS: memoryR2() };
  return { env, call: api(handleStoreApi, env, await developerToken(handleStoreApi, env)) };
}

test("an uploaded .vtt is stored in R2, read back, and saved after edits", async () => {
  const { env, call } = await setup();
  const data = new FormData();
  data.set("caption", new File([VTT], "talk.vtt", { type: "text/vtt" }));
  data.set("language", "zh-HK");
  const uploaded = await (await call("/api/cms/upload-video-captions", { method: "POST", body: data })).json();
  assert.match(uploaded.captionUrl, /^\/uploads\/captions\/upload-\d+-[a-f0-9]{6}\.vtt$/);
  assert.equal(uploaded.language, "zh");
  assert.equal(uploaded.cueCount, 1);

  const read = await (await call(`/api/cms/video-captions?captionUrl=${encodeURIComponent(uploaded.captionUrl)}`)).json();
  assert.equal(read.text, VTT);
  assert.equal(read.editable, true);

  const edited = VTT.replace("Hello", "Hello again");
  const saved = await call("/api/cms/video-captions", { method: "PUT", json: { captionUrl: uploaded.captionUrl, text: edited } });
  assert.equal(saved.status, 200);
  assert.equal(await (await env.UPLOADS.get(uploaded.captionUrl.slice(1))).text(), edited);
});

test("a file that is not WebVTT is refused", async () => {
  const { call } = await setup();
  const data = new FormData();
  data.set("caption", new File(["just text"], "notes.vtt", { type: "text/vtt" }));
  assert.equal((await call("/api/cms/upload-video-captions", { method: "POST", body: data })).status, 400);
  const bad = await call("/api/cms/video-captions", { method: "PUT", json: { captionUrl: "/uploads/captions/x.vtt", text: VTT } });
  assert.equal(bad.status, 400);
});

test("captions are made from a video's sound and kept in R2", async () => {
  const { env, call } = await setup();
  env.CMS_API_BASE = "https://cms.test";
  env.MEDIA = {
    getByName: () => ({
      fetch: async (request) => {
        assert.equal(new URL(request.url).pathname, "/audio/chunks");
        assert.equal(await request.text(), "video");
        return Response.json({ chunks: [{ base64: btoa("mp3"), format: "mp3", durationMs: 3000 }] });
      },
    }),
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ text: "Hello and welcome" });
  try {
    await env.UPLOADS.put("uploads/videos/a.mp4", "video");
    const response = await call("/api/cms/generate-video-captions", {
      method: "POST",
      json: { videoUrl: "/uploads/videos/a.mp4", language: "zh-HK" },
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.language, "zh");
    assert.equal(body.cueCount, 1);
    assert.match(body.captionUrl, /^\/uploads\/captions\/captions-\d+-[a-f0-9]{8}\.vtt$/);
    const vtt = await (await env.UPLOADS.get(body.captionUrl.slice(1))).text();
    assert.equal(vtt, "WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\nHello and welcome\n");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("captions for a video that is not stored answer 404", async () => {
  const { env, call } = await setup();
  env.MEDIA = { getByName: () => ({ fetch: async () => Response.json({ chunks: [] }) }) };
  const response = await call("/api/cms/generate-video-captions", { method: "POST", json: { videoUrl: "/uploads/videos/a.mp4" } });
  assert.equal(response.status, 404);
});
