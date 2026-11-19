import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { handleStoreApi } from "./d1-api.js";
import { developerToken, memoryD1, memoryR2 } from "./test-env.js";
import { handleAutoclassApi } from "./autoclass-api.js";
import { lessonDocName, publishRender, readLesson, writeLesson } from "./autoclass-lessons.js";
import { devRenderer } from "./autoclass-job.js";

const script = JSON.parse(readFileSync(new URL("../autoclass-video/lessons/animal-homes.json", import.meta.url), "utf8"));

// A stand-in for the AUTOCLASS_VIDEO namespace: one job state per job id.
function renderNamespace() {
  const jobs = new Map();
  const calls = [];
  return {
    jobs,
    calls,
    getByName(name) {
      return {
        fetch: async (url, init = {}) => {
          const path = new URL(url).pathname;
          const body = init.body ? JSON.parse(init.body) : undefined;
          calls.push({ name, path, body });
          if (path === "/start") {
            jobs.set(name, { jobId: name, ...body.meta, status: "queued", logs: ["Queued."] });
            return Response.json(jobs.get(name), { status: 202 });
          }
          return Response.json(jobs.get(name) || { status: "missing" });
        },
      };
    },
  };
}

async function setup({ enabled = true } = {}) {
  const AUTOCLASS_VIDEO = renderNamespace();
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), CMS_API_BASE: "https://cms.test", AUTOCLASS_VIDEO };
  const token = await developerToken(handleStoreApi, env);
  if (enabled) env.AUTOCLASS = "1";
  const call = async (path, { method = "GET", json, auth = true } = {}) => {
    const url = new URL(path, "https://class.lango.ai");
    const headers = new Headers();
    if (auth) headers.set("authorization", `Bearer ${token}`);
    if (json !== undefined) headers.set("content-type", "application/json");
    const res = await handleAutoclassApi(new Request(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined }), env, url);
    return { status: res?.status, body: res ? await res.json().catch(() => null) : null, res };
  };
  return { env, call, AUTOCLASS_VIDEO };
}

test("the API is a 404 unless AUTOCLASS is on, and leaves other paths alone", async () => {
  const { call, env } = await setup({ enabled: false });
  assert.equal((await call("/api/autoclass/lessons/animal-homes/cues")).status, 404);
  assert.equal((await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: script })).status, 404);
  const url = new URL("https://class.lango.ai/api/video");
  assert.equal(await handleAutoclassApi(new Request(url), env, url), null);
});

test("saving needs a teacher and a valid script", async () => {
  const { call } = await setup();
  assert.equal((await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: script, auth: false })).status, 401);
  const bad = structuredClone(script);
  bad.scenes[2].correct = 9;
  const refused = await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: bad });
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.body.errors.map((e) => e.path), ["scenes[2].correct"]);
  const otherId = await call("/api/autoclass/lessons/fish", { method: "PUT", json: script });
  assert.equal(otherId.status, 400);
  assert.equal((await call("/api/autoclass/lessons/Not_An_Id", { method: "PUT", json: script })).status, 400);
});

test("a saved script reads back, with no render yet", async () => {
  const { call, env } = await setup();
  const saved = await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: { script } });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.lesson.title, "Animal Homes");
  assert.equal(saved.body.lesson.published, null);
  const row = await readLesson(env, "animal-homes");
  assert.equal(row.teacherId, 835);
  assert.deepEqual(row.script, script, "the script is kept as written; defaults are filled in at render time");
  const again = await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: script });
  assert.equal(again.status, 200);
  const read = await call("/api/autoclass/lessons/animal-homes");
  assert.equal(read.status, 200);
  assert.equal(read.body.lesson.script.id, "animal-homes");
  assert.equal((await call("/api/autoclass/lessons/missing")).status, 404);
});

test("a script id may be left out; the URL gives it", async () => {
  const { call } = await setup();
  const { id, ...rest } = structuredClone(script);
  const saved = await call("/api/autoclass/lessons/animal-homes-2", { method: "PUT", json: rest });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.lesson.id, "animal-homes-2");
});

test("another teacher's lesson cannot be changed, read or rendered", async () => {
  const { call, env } = await setup();
  await writeLesson(env, { id: "animal-homes", teacherId: 99, script, createdAt: "x", updatedAt: "x" });
  assert.equal((await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: script })).status, 403);
  assert.equal((await call("/api/autoclass/lessons/animal-homes")).status, 404);
  assert.equal((await call("/api/autoclass/lessons/animal-homes/render", { method: "POST" })).status, 404);
});

test("rendering sends the normalised script, every line and the render folder to a new job", async () => {
  const { call, env, AUTOCLASS_VIDEO } = await setup();
  await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: script });
  const started = await call("/api/autoclass/lessons/animal-homes/render", { method: "POST" });
  assert.equal(started.status, 202);
  const { jobId } = started.body;
  assert.match(jobId, /^[a-f0-9]{32}$/);
  const sent = AUTOCLASS_VIDEO.calls.find((c) => c.path === "/start").body;
  assert.equal(sent.lessonId, "animal-homes");
  assert.equal(sent.mediaUrl, `/uploads/autoclass/animal-homes/${jobId}`);
  assert.equal(sent.routerBase, "https://cms.test/api/router");
  assert.equal(sent.voiceCacheUrl, "https://class.lango.ai/uploads/autoclass/_voice");
  assert.ok(sent.script.analysis.allRight.length, "defaults filled in");
  assert.ok(sent.lines.includes(script.intro.say[0]));
  assert.equal(new Set(sent.lines).size, sent.lines.length);
  assert.equal(sent.meta.lessonId, "animal-homes");
  assert.match(sent.meta.scriptHash, /^[a-f0-9]{16}$/);
  assert.equal((await readLesson(env, "animal-homes")).render.jobId, jobId);

  // A second request while it runs gets the same job.
  const again = await call("/api/autoclass/lessons/animal-homes/render", { method: "POST" });
  assert.equal(again.body.jobId, jobId);
  assert.equal(again.body.alreadyRunning, true);

  const status = await call(`/api/autoclass/jobs/${jobId}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.status, "queued");
  assert.equal(status.body.lessonId, "animal-homes");
  assert.equal((await call("/api/autoclass/jobs/nope")).status, 404);

  // Once it has finished, rendering again starts a new job.
  AUTOCLASS_VIDEO.jobs.get(jobId).status = "failed";
  const retry = await call("/api/autoclass/lessons/animal-homes/render", { method: "POST" });
  assert.notEqual(retry.body.jobId, jobId);

  // PUBLIC_BASE_URL, when set, is where the renderer reads the voice cache.
  env.PUBLIC_BASE_URL = "http://localhost:8792/";
  AUTOCLASS_VIDEO.jobs.get(retry.body.jobId).status = "completed";
  await call("/api/autoclass/lessons/animal-homes/render", { method: "POST" });
  assert.equal(AUTOCLASS_VIDEO.calls.filter((c) => c.path === "/start").at(-1).body.voiceCacheUrl, "http://localhost:8792/uploads/autoclass/_voice");
});

test("the page gets the published cues, not a render still in progress", async () => {
  const { call, env } = await setup();
  await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: script });
  const none = await call("/api/autoclass/lessons/animal-homes/cues", { auth: false });
  assert.equal(none.status, 404);
  assert.match(none.body.message, /not been rendered/);

  await env.UPLOADS.put("uploads/autoclass/animal-homes/r1/cues.json", JSON.stringify({ title: "Animal Homes", cues: [] }));
  await publishRender(env, "animal-homes", { renderId: "r1", scriptHash: "x", mediaUrl: "/uploads/autoclass/animal-homes/r1", startedAt: 2 });
  const cues = await call("/api/autoclass/lessons/animal-homes/cues", { auth: false });
  assert.equal(cues.status, 200);
  assert.equal(cues.res.headers.get("cache-control"), "no-store");
  assert.equal(cues.body.title, "Animal Homes");

  // An older render finishing late does not replace it.
  await publishRender(env, "animal-homes", { renderId: "r0", startedAt: 1 });
  assert.equal((await readLesson(env, "animal-homes")).published.renderId, "r1");

  const read = await call("/api/autoclass/lessons/animal-homes");
  assert.equal(read.body.lesson.published.current, false, "rendered from another version of the script");
  assert.equal(read.body.lesson.playUrl, "/autoclass.html?lesson=animal-homes");
});

test("a teacher can clean their own lesson's old renders now", async () => {
  const { call, env } = await setup();
  await call("/api/autoclass/lessons/animal-homes", { method: "PUT", json: script });
  const old = "a".repeat(32);
  await env.UPLOADS.put(`uploads/autoclass/animal-homes/${old}/cues.json`, "{}");
  env.UPLOADS.objects.get(`uploads/autoclass/animal-homes/${old}/cues.json`).uploaded = new Date(Date.now() - 7 * 60 * 60 * 1000);
  const res = await call("/api/autoclass/lessons/animal-homes/cleanup", { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.deleted, [old]);
  await writeLesson(env, { id: "theirs", teacherId: 99, script });
  assert.equal((await call("/api/autoclass/lessons/theirs/cleanup", { method: "POST" })).status, 404);
  assert.equal((await call("/api/autoclass/lessons/animal-homes/cleanup")).status, 405);
});

test("lessons are their own D1 rows", () => {
  assert.equal(lessonDocName("animal-homes"), "autoclass-lesson:animal-homes");
});

test("the local renderer switch takes only a localhost URL", () => {
  assert.equal(devRenderer({ AUTOCLASS_RENDERER_URL: "http://localhost:8080/" }), "http://localhost:8080");
  assert.equal(devRenderer({ AUTOCLASS_RENDERER_URL: "http://127.0.0.1:9000" }), "http://127.0.0.1:9000");
  assert.equal(devRenderer({ AUTOCLASS_RENDERER_URL: "https://evil.example" }), "");
  assert.equal(devRenderer({ AUTOCLASS_RENDERER_URL: "http://localhost.evil.example" }), "");
  assert.equal(devRenderer({}), "");
});
