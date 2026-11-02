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

test("captions from a video say ffmpeg is missing instead of hanging", async () => {
  const { call } = await setup();
  const response = await call("/api/cms/generate-video-captions", { method: "POST", json: { videoUrl: "/uploads/videos/a.mp4" } });
  assert.equal(response.status, 501);
  assert.match((await response.json()).message, /ffmpeg/);
});
