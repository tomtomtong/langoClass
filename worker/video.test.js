import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { developerToken, memoryD1 } from "./test-env.js";
import { handleVideoRequest } from "./video.js";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// A stand-in for the VIDEO Durable Object namespace: one stub per job name.
function videoNamespace(handler) {
  const calls = [];
  return {
    calls,
    getByName(name) {
      return {
        fetch: async (url, init = {}) => {
          const body = init.body ? JSON.parse(init.body) : undefined;
          calls.push({ name, path: new URL(url).pathname, body });
          return handler(name, new URL(url).pathname, body);
        },
      };
    },
  };
}

async function setup(handler) {
  const VIDEO = videoNamespace(handler);
  const env = { DB: memoryD1(), CMS_API_BASE: "https://cms.test", VIDEO };
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
  return { env, call, VIDEO };
}

test("starting a video starts a Tommy render job, not the newcms video API", async () => {
  const { call, VIDEO } = await setup(() => Response.json({ status: "queued" }, { status: 202 }));
  for (const path of ["/api/video", "/api/cms/generate-video"]) {
    const response = await call(path, { method: "POST", json: { text: "  Hello class  " } });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.status, "queued");
    assert.match(body.jobId, /^[a-f0-9]{32}$/);
  }
  assert.equal(VIDEO.calls.length, 2);
  for (const { name, path, body } of VIDEO.calls) {
    assert.equal(path, "/start");
    assert.equal(body.jobId, name);
    assert.deepEqual({ text: body.text, routerBase: body.routerBase }, { text: "Hello class", routerBase: "https://cms.test/api/router" });
  }
});

test("a finished job returns its R2 video URL", async () => {
  const { call } = await setup((name, path) => {
    assert.equal(name, "job-1");
    assert.equal(path, "/status");
    return Response.json({ status: "completed", videoUrl: "/uploads/lectures/tommy-job-1.mp4", logs: ["Saved."] });
  });
  for (const path of ["/api/video/job-1", "/api/cms/video-jobs/job-1"]) {
    const body = await (await call(path)).json();
    assert.equal(body.status, "completed");
    assert.equal(body.videoUrl, "/uploads/lectures/tommy-job-1.mp4");
  }
});

test("an unknown job is 404", async () => {
  const { call } = await setup(() => Response.json({ status: "missing" }));
  assert.equal((await call("/api/video/nope")).status, 404);
});

test("a job id cannot leave the video route", async () => {
  const { call } = await setup(() => {
    throw new Error("Unexpected call");
  });
  assert.equal((await call("/api/video/..%2Fsecret")).status, 400);
  assert.equal((await call("/api/video", { method: "POST", json: { text: " " } })).status, 400);
});

test("video routes need a teacher login", async () => {
  const env = { DB: memoryD1(), CMS_API_BASE: "https://cms.test", VIDEO: videoNamespace(() => Response.json({})) };
  globalThis.fetch = async () => new Response("no", { status: 401 });
  const url = new URL("https://class.lango.ai/api/video/job-1");
  const response = await handleVideoRequest(new Request(url, { headers: { authorization: "Bearer bad", "x-teacher-id": "5" } }), env, url);
  assert.equal(response.status, 401);
});

test("a renderer that cannot start is reported as 502 with its message", async () => {
  const { call } = await setup(() => Response.json({ status: "failed", error: "container out of capacity" }, { status: 502 }));
  const response = await call("/api/video", { method: "POST", json: { text: "Hi" } });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).message, "container out of capacity");
});
