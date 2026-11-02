import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { developerToken, memoryD1 } from "./test-env.js";
import { handleVideoRequest } from "./video.js";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

async function setup() {
  const env = { DB: memoryD1(), CMS_API_BASE: "https://cms.test", ORIGIN: "https://classroom.lango.ai" };
  const token = await developerToken(handleStoreApi, env);
  const call = (path, init = {}) => {
    const url = new URL(path, "https://class.lango.ai");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init.json) headers.set("content-type", "application/json");
    return handleVideoRequest(
      new Request(url, { method: init.method || "GET", headers, body: init.json ? JSON.stringify(init.json) : undefined }),
      env,
      url
    );
  };
  return { env, call };
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

test("starting a video calls the newcms video API, not the old server", async () => {
  const { call } = await setup();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://cms.test/api/video");
    assert.deepEqual(JSON.parse(init.body), { text: "Hello class" });
    return jsonResponse({ job_id: "job-1", status: "queued" }, 202);
  };
  for (const path of ["/api/video", "/api/cms/generate-video"]) {
    const response = await call(path, { method: "POST", json: { text: "  Hello class  " } });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, jobId: "job-1", status: "queued" });
  }
});

test("a finished job returns the full video URL", async () => {
  const { call } = await setup();
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://cms.test/api/jobs/job-1");
    return jsonResponse({ id: "job-1", status: "completed", video_url: "/files/job-1.mp4", logs: ["done"] });
  };
  for (const path of ["/api/video/job-1", "/api/cms/video-jobs/job-1"]) {
    const body = await (await call(path)).json();
    assert.equal(body.status, "completed");
    assert.equal(body.videoUrl, "https://cms.test/files/job-1.mp4");
  }
});

test("a job id cannot leave the video route", async () => {
  const { call } = await setup();
  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch ${url}`);
  };
  assert.equal((await call("/api/video/..%2Fsecret")).status, 400);
  assert.equal((await call("/api/video", { method: "POST", json: { text: " " } })).status, 400);
});

test("video routes need a teacher login", async () => {
  const env = { DB: memoryD1(), CMS_API_BASE: "https://cms.test" };
  globalThis.fetch = async () => new Response("no", { status: 401 });
  const url = new URL("https://class.lango.ai/api/video/job-1");
  const response = await handleVideoRequest(new Request(url, { headers: { authorization: "Bearer bad", "x-teacher-id": "5" } }), env, url);
  assert.equal(response.status, 401);
});

test("an API error is reported as 502 with its message", async () => {
  const { call } = await setup();
  globalThis.fetch = async () => jsonResponse({ error: "quota exceeded" }, 429);
  const response = await call("/api/video", { method: "POST", json: { text: "Hi" } });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).message, "quota exceeded");
});
