import assert from "node:assert/strict";
import test from "node:test";
import { poll, resumeStalled, startJob, tryStart } from "./video-job.js";
import { memoryR2 } from "./test-env.js";

// FixedLengthStream is Workers-only; a pass-through stream stands in for it.
globalThis.FixedLengthStream ??= class extends TransformStream {
  constructor() {
    super();
  }
};

// A VideoContainer stand-in: storage, scheduled calls, and a render container
// that answers from `routes` (a function per path, or an Error to throw).
function box(routes = {}) {
  const store = new Map();
  const calls = { scheduled: [], stopped: 0, fetched: [] };
  return {
    calls,
    env: { UPLOADS: memoryR2() },
    ctx: {
      storage: {
        get: async (key) => structuredClone(store.get(key)),
        put: async (key, value) => void store.set(key, structuredClone(value)),
        delete: async (key) => store.delete(key),
      },
    },
    async containerFetch(url, init) {
      const path = new URL(url).pathname;
      calls.fetched.push(path);
      const route = routes[path];
      if (route instanceof Error) throw route;
      if (!route) return new Response("Not found", { status: 404 });
      return route(init);
    },
    async schedule(seconds, callback) {
      calls.scheduled.push([seconds, callback]);
    },
    async stop() {
      calls.stopped++;
    },
  };
}

const START = { jobId: "job1", text: "Ordering coffee.", routerBase: "https://cms.test/api/router" };

test("a job starts on a free renderer and polls it", async () => {
  let sent;
  const b = box({ "/jobs": (init) => ((sent = JSON.parse(init.body)), Response.json({ status: "queued" }, { status: 202 })) });
  const res = await startJob(b, START);
  const job = await res.json();
  assert.equal(job.status, "planning");
  assert.deepEqual(sent, START);
  assert.deepEqual(b.calls.scheduled, [[15, "poll"]]);
  assert.equal(await b.ctx.storage.get("request"), undefined, "the script is not kept once the render has it");
});

test("when every renderer is busy the job waits in line and starts later", async () => {
  const routes = { "/jobs": new Error("There is no container instance available") };
  const b = box(routes);
  const job = await (await startJob(b, START)).json();
  assert.equal(job.status, "queued");
  assert.match(job.logs.at(-1), /Waiting for a free video renderer/);
  assert.deepEqual(b.calls.scheduled, [[20, "tryStart"]]);

  routes["/jobs"] = () => Response.json({ status: "queued" }, { status: 202 });
  await tryStart(b);
  assert.equal((await b.ctx.storage.get("job")).status, "planning");
  assert.deepEqual(b.calls.scheduled.at(-1), [15, "poll"]);
});

test("a job that waits too long fails instead of waiting forever", async () => {
  const b = box({ "/jobs": new Error("busy") });
  await startJob(b, START);
  const job = await b.ctx.storage.get("job");
  await b.ctx.storage.put("job", { ...job, queuedAt: Date.now() - 31 * 60 * 1000 });
  await tryStart(b);
  const failed = await b.ctx.storage.get("job");
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /renderers stayed busy/);
});

test("a finished video is copied into R2 and the renderer stops", async () => {
  const mp4 = new Uint8Array(200000).fill(9);
  const b = box({
    "/jobs/job1": () => Response.json({ status: "completed", logs: ["Done."] }),
    "/jobs/job1/video": () => new Response(mp4, { headers: { "content-length": String(mp4.length) } }),
  });
  await b.ctx.storage.put("job", { jobId: "job1", status: "rendering", logs: [], startedAt: Date.now() });
  await poll(b);
  const job = await b.ctx.storage.get("job");
  assert.equal(job.status, "completed");
  assert.equal(job.videoUrl, "/uploads/lectures/tommy-job1.mp4");
  const stored = await b.env.UPLOADS.get("lectures/tommy-job1.mp4");
  assert.equal((await stored.arrayBuffer()).byteLength, mp4.length);
  assert.equal(b.calls.stopped, 1);
});

test("a save that keeps failing gives up after a few tries", async () => {
  const b = box({
    "/jobs/job1": () => Response.json({ status: "completed", logs: [] }),
    "/jobs/job1/video": () => new Response("gone", { status: 500 }),
  });
  await b.ctx.storage.put("job", { jobId: "job1", status: "saving", logs: [], startedAt: Date.now() - 2 * 60 * 60 * 1000 });
  for (let i = 0; i < 4; i++) await poll(b);
  const job = await b.ctx.storage.get("job");
  assert.equal(job.status, "failed", "saving is not cut off by the render time limit, only by its own tries");
  assert.match(job.error, /could not be saved/);
});

test("a job whose polling stopped is picked up again on start-up", async () => {
  const b = box();
  await b.ctx.storage.put("job", { jobId: "job1", status: "saving", logs: [], startedAt: 0 });
  await resumeStalled(b);
  assert.deepEqual(b.calls.scheduled, [[15, "poll"]]);

  const waiting = box();
  await waiting.ctx.storage.put("job", { jobId: "job2", status: "queued", logs: [], queuedAt: 0, lastPolledAt: 0 });
  await resumeStalled(waiting);
  assert.deepEqual(waiting.calls.scheduled, [[20, "tryStart"]]);

  const busy = box();
  await busy.ctx.storage.put("job", { jobId: "job3", status: "rendering", logs: [], lastPolledAt: Date.now() });
  await resumeStalled(busy);
  assert.deepEqual(busy.calls.scheduled, [], "a job still being polled is left alone");
});
