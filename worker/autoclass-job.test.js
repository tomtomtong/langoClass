import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { poll, startJob } from "./video-job.js";
import { AUTOCLASS_PATHS, saveLessonRender } from "./autoclass-job.js";
import { readLesson, writeLesson } from "./autoclass-lessons.js";
import { memoryD1, memoryR2 } from "./test-env.js";
import { validateLessonScript } from "../lib/autoclass-script.mjs";
import { buildLesson } from "../video-container/autoclass/lesson.mjs";
import { listFiles } from "../video-container/autoclass/job.mjs";

globalThis.FixedLengthStream ??= class extends TransformStream {
  constructor() {
    super();
  }
};

const animalHomes = JSON.parse(readFileSync(new URL("../autoclass-video/lessons/animal-homes.json", import.meta.url), "utf8"));

// An AutoclassContainer stand-in: storage, schedule, and a renderer answering from `routes`.
function box(routes) {
  const store = new Map();
  const calls = { scheduled: [], stopped: 0, fetched: [] };
  return {
    calls,
    env: { UPLOADS: memoryR2(), DB: memoryD1() },
    paths: AUTOCLASS_PATHS,
    startedStatus: "voicing",
    ctx: {
      storage: {
        get: async (key) => structuredClone(store.get(key)),
        put: async (key, value) => void store.set(key, structuredClone(value)),
        delete: async (key) => store.delete(key),
      },
    },
    async containerFetch(url, init) {
      const p = decodeURIComponent(new URL(url).pathname);
      calls.fetched.push(p);
      const route = routes[p];
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
    saveOutput(job, state) {
      return saveLessonRender(this, job, state);
    },
  };
}

const file = (text, type) => () => new Response(text, { headers: { "content-type": type, "content-length": String(Buffer.byteLength(text)) } });
const FILES = [
  { name: "analysis/an-leadIn-1.mp3", size: 3, type: "audio/mpeg" },
  { name: "animal-homes.mp4", size: 5, type: "video/mp4" },
  { name: "cues.json", size: 2, type: "application/json" },
];

function finishedRenderer(extra = {}) {
  return {
    "/autoclass/jobs": () => Response.json({ status: "queued" }, { status: 202 }),
    "/autoclass/jobs/r1": () => Response.json({ status: "completed", logs: ["Done."], files: FILES }),
    "/autoclass/jobs/r1/files/analysis/an-leadIn-1.mp3": file("mp3", "audio/mpeg"),
    "/autoclass/jobs/r1/files/animal-homes.mp4": file("video", "video/mp4"),
    "/autoclass/jobs/r1/files/cues.json": file("{}", "application/json"),
    ...extra,
  };
}

async function started(b) {
  await writeLesson(b.env, { id: "animal-homes", teacherId: 835, script: animalHomes, createdAt: "x", updatedAt: "x" });
  await startJob(b, { jobId: "r1", meta: { lessonId: "animal-homes", scriptHash: "abc" }, lessonId: "animal-homes", script: {}, lines: [], mediaUrl: "/uploads/autoclass/animal-homes/r1", routerBase: "https://cms.test/api/router" });
}

test("a lesson render starts on the autoclass routes and keeps its lesson on the job", async () => {
  const b = box(finishedRenderer());
  await started(b);
  const job = await b.ctx.storage.get("job");
  assert.equal(job.status, "voicing");
  assert.equal(job.lessonId, "animal-homes");
  assert.deepEqual(b.calls.fetched, ["/autoclass/jobs"]);
});

test("a finished render is copied into its R2 folder, cues last, then published", async () => {
  const b = box(finishedRenderer());
  await started(b);
  await poll(b);
  const job = await b.ctx.storage.get("job");
  assert.equal(job.status, "completed");
  assert.equal(job.cuesUrl, "/uploads/autoclass/animal-homes/r1/cues.json");
  assert.equal(job.videoUrl, "/uploads/autoclass/animal-homes/r1/animal-homes.mp4");
  const saved = b.calls.fetched.filter((p) => p.includes("/files/"));
  assert.equal(saved.at(-1), "/autoclass/jobs/r1/files/cues.json");
  assert.equal(await (await b.env.UPLOADS.get("uploads/autoclass/animal-homes/r1/animal-homes.mp4")).text(), "video");
  assert.equal(await (await b.env.UPLOADS.get("uploads/autoclass/animal-homes/r1/analysis/an-leadIn-1.mp3")).text(), "mp3");
  const lesson = await readLesson(b.env, "animal-homes");
  assert.equal(lesson.published.renderId, "r1");
  assert.equal(lesson.published.scriptHash, "abc");
  assert.equal(b.calls.stopped, 1);
});

test("a save that fails part way picks up from the next file", async () => {
  let fails = 1;
  const b = box(finishedRenderer({
    "/autoclass/jobs/r1/files/animal-homes.mp4": () => (fails-- > 0 ? new Response("busy", { status: 503 }) : file("video", "video/mp4")()),
  }));
  await started(b);
  await poll(b);
  let job = await b.ctx.storage.get("job");
  assert.equal(job.status, "saving");
  assert.equal(job.savedFiles, 1);
  assert.equal((await readLesson(b.env, "animal-homes")).published, undefined, "not published until every file is in");
  await poll(b);
  job = await b.ctx.storage.get("job");
  assert.equal(job.status, "completed");
  assert.equal(b.calls.fetched.filter((p) => p.endsWith("an-leadIn-1.mp3")).length, 1, "a saved file is not copied twice");
});

test("a render listing odd files or no cues fails", async () => {
  const b = box(finishedRenderer({ "/autoclass/jobs/r1": () => Response.json({ status: "completed", files: [{ name: "../x.mp3" }, FILES[2]] }) }));
  await started(b);
  await poll(b);
  assert.match((await b.ctx.storage.get("job")).error, /unexpected file/);
  const c = box(finishedRenderer({ "/autoclass/jobs/r1": () => Response.json({ status: "completed", files: FILES.slice(0, 2) }) }));
  await started(c);
  await poll(c);
  assert.match((await c.ctx.storage.get("job")).error, /cues/);
});

test("the builder writes the project and cues from a script, timed to the voice", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-build-"));
  try {
    const { script } = validateLessonScript(animalHomes);
    const voiced = [];
    // Every line "lasts" two seconds; the files are placeholders.
    const voice = async (text) => {
      const name = `assets/voice/v${voiced.length}.mp3`;
      voiced.push(text);
      writeFileSync(path.join(dir, name), "mp3");
      return { file: name, seconds: 2 };
    };
    (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    const built = await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1" });
    const cues = JSON.parse(readFileSync(path.join(dir, "out", "cues.json"), "utf8"));
    assert.equal(cues.video, "/uploads/autoclass/animal-homes/r1/animal-homes.mp4");
    assert.equal(cues.duration, built.total);
    assert.deepEqual(cues.cues.map((c) => (c.poll ? "poll" : c.speak ? "speak" : "quiz")), ["speak", "quiz", "poll", "quiz"]);
    const times = cues.cues.map((c) => c.at);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.ok(cues.cues.every((c) => c.at < built.total));
    assert.equal(cues.cues[1].exercise.type, "mcquiz");
    assert.equal(cues.cues[1].exercise.items[0].options[1].isCorrect, true);
    assert.equal(cues.cues[1].result.wrong[0][0].url, "/uploads/autoclass/animal-homes/r1/analysis/q1-wrong-1-1.mp3");
    assert.equal(cues.tutor.breaks.length, 6);
    assert.equal(cues.tutor.tommyVideo, "/uploads/autoclass/animal-homes/r1/tommy-talking.webm");
    assert.ok(cues.analysis.allRight.every((line) => line.url.startsWith("/uploads/autoclass/animal-homes/r1/analysis/")));
    const index = readFileSync(path.join(dir, "index.html"), "utf8");
    assert.match(index, /data-composition-src="compositions\/teach1.html"/);
    assert.match(index, /src="assets\/voice\/v0.mp3"/);
    assert.match(readFileSync(path.join(dir, "compositions", "intro.html"), "utf8"), /<span class="word">Where <\/span><span class="word">do<\/span><br \/><span class="word hl">animals<\/span>/);
    assert.match(readFileSync(path.join(dir, "compositions", "outro.html"), "utf8"), /<span class="to">lives in a<\/span><span class="h">nest<\/span>/);

    // What the container lists for the Worker to save: everything under out/, cues last.
    writeFileSync(path.join(dir, "out", "animal-homes.mp4"), "video");
    const files = listFiles(path.join(dir, "out"));
    assert.equal(files.at(-1).name, "cues.json");
    assert.ok(files.some((f) => f.name === "tommy-talking.webm" && f.type === "video/webm"));
    assert.ok(files.some((f) => f.name === "poll1-ask.mp3" && f.type === "audio/mpeg"));
    assert.ok(files.every((f) => /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:mp4|mp3|webm|json)$/.test(f.name)), "names pass the Worker's check");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
