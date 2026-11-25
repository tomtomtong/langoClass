import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { poll, startJob } from "./video-job.js";
import { AUTOCLASS_PATHS, saveLessonRender } from "./autoclass-job.js";
import { readLesson, writeLesson } from "./autoclass-lessons.js";
import { memoryD1, memoryR2 } from "./test-env.js";
import { validateLessonScript } from "../lib/autoclass-script.mjs";
import { buildLesson } from "../video-container/autoclass/lesson.mjs";
import { badAutoclassRequest, fetchMedia, listFiles, makeVoice, mediaFiles, renderSeeThrough } from "../video-container/autoclass/job.mjs";
import { voiceKey } from "../video-container/voice.mjs";
import { uploadKey } from "./uploads.js";

globalThis.FixedLengthStream ??= class extends TransformStream {
  constructor() {
    super();
  }
};

const animalHomes = JSON.parse(readFileSync(new URL("./fixtures/animal-homes.json", import.meta.url), "utf8"));

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

test("publishing a render retires the one it replaces and clears old unpublished ones", async () => {
  const b = box(finishedRenderer());
  await started(b);
  const before = "b".repeat(32);
  const stale = "c".repeat(32);
  await b.env.UPLOADS.put(`uploads/autoclass/animal-homes/${before}/cues.json`, "{}");
  await b.env.UPLOADS.put(`uploads/autoclass/animal-homes/${stale}/cues.json`, "{}");
  b.env.UPLOADS.objects.get(`uploads/autoclass/animal-homes/${before}/cues.json`).uploaded = new Date(Date.now() - 30 * 3600e3);
  b.env.UPLOADS.objects.get(`uploads/autoclass/animal-homes/${stale}/cues.json`).uploaded = new Date(Date.now() - 30 * 3600e3);
  const lesson = await readLesson(b.env, "animal-homes");
  await writeLesson(b.env, { ...lesson, published: { renderId: before, startedAt: 0 } });
  await poll(b);
  const after = await readLesson(b.env, "animal-homes");
  assert.equal(after.published.renderId, "r1");
  assert.deepEqual(after.retired.map((r) => r.renderId), [before]);
  assert.ok(await b.env.UPLOADS.get(`uploads/autoclass/animal-homes/${before}/cues.json`), "just replaced: kept for classes still on it");
  assert.equal(await b.env.UPLOADS.get(`uploads/autoclass/animal-homes/${stale}/cues.json`), null);
});

test("lines voiced fresh go into the shared voice cache, not the render folder", async () => {
  const listed = [{ name: "_voice/abc123.mp3", size: 3, type: "audio/mpeg" }, ...FILES];
  const b = box(finishedRenderer({
    "/autoclass/jobs/r1": () => Response.json({ status: "completed", files: listed }),
    "/autoclass/jobs/r1/files/_voice/abc123.mp3": file("new", "audio/mpeg"),
  }));
  await started(b);
  await poll(b);
  assert.equal((await b.ctx.storage.get("job")).status, "completed");
  assert.equal(await (await b.env.UPLOADS.get("uploads/autoclass/_voice/abc123.mp3")).text(), "new");
  assert.equal(await b.env.UPLOADS.get("uploads/autoclass/animal-homes/r1/_voice/abc123.mp3"), null);
  assert.equal(uploadKey("/uploads/autoclass/_voice/abc123.mp3"), "uploads/autoclass/_voice/abc123.mp3", "served by the uploads route");
});

test("the renderer reads lines from the cache and voices only the rest", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-voice-"));
  try {
    (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    const cached = voiceKey("Hello!", "en-US", 1);
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      if (url.endsWith(`/${cached}.mp3`)) return new Response("cached-mp3");
      if (url.includes(voiceKey("Flaky.", "en-US", 1))) throw new Error("network");
      return new Response("Not found", { status: 404 });
    };
    const spoken = [];
    const stats = { cached: 0, voiced: 0 };
    const voice = makeVoice({
      dir,
      language: "en-US",
      rate: 1,
      cacheUrl: "https://class.test/uploads/autoclass/_voice",
      speakLine: async (text) => (spoken.push(text), Buffer.from(`tts:${text}`)),
      stats,
      fetchImpl,
      seconds: () => 1.5,
    });
    const [hello, bye, again, flaky] = await Promise.all([voice("Hello!"), voice("Bye!"), voice("Bye!"), voice("Flaky.")]);
    assert.deepEqual(spoken, ["Bye!", "Flaky."], "a miss or a cache error is voiced; each text once");
    assert.deepEqual(stats, { cached: 1, voiced: 2, problem: "cache unreachable: network" }, "a 404 is a plain miss; other trouble is noted once");
    assert.equal(asked[0], `https://class.test/uploads/autoclass/_voice/${cached}.mp3`);
    assert.equal(readFileSync(path.join(dir, hello.file), "utf8"), "cached-mp3");
    assert.equal(hello.seconds, 1.5);
    assert.equal(bye, again);
    const fresh = listFiles(path.join(dir, "out")).map((f) => f.name);
    assert.deepEqual(fresh.sort(), [`_voice/${voiceKey("Bye!", "en-US", 1)}.mp3`, `_voice/${voiceKey("Flaky.", "en-US", 1)}.mp3`].sort());
    assert.ok(flaky.file.endsWith(".mp3"));

    // Without a cache URL every line is voiced.
    const plain = makeVoice({ dir, language: "en-US", rate: 1, cacheUrl: "", speakLine: async () => Buffer.from("x"), fetchImpl: () => assert.fail("no cache"), seconds: () => 1 });
    await plain("Hello!");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cache key changes with anything that changes the sound", () => {
  const base = voiceKey("Hello!", "en-US", 1);
  assert.match(base, /^[a-f0-9]{24}$/);
  assert.equal(voiceKey("Hello!", "en-US", 1), base);
  assert.notEqual(voiceKey("Hello.", "en-US", 1), base);
  assert.notEqual(voiceKey("Hello!", "en-GB", 1), base);
  assert.notEqual(voiceKey("Hello!", "en-US", 1.1), base);
});

test("the renderer takes only the voice cache as its cache URL", () => {
  const ok = { jobId: "r1", lessonId: "a", script: { id: "a" }, mediaUrl: "/uploads/autoclass/a/r1", routerBase: "https://cms.test/api/router" };
  assert.equal(badAutoclassRequest(ok), "");
  assert.equal(badAutoclassRequest({ ...ok, voiceCacheUrl: "https://class.lango.ai/uploads/autoclass/_voice" }), "");
  assert.match(badAutoclassRequest({ ...ok, voiceCacheUrl: "https://evil.test/x" }), /voice cache/);
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

test("an ask scene becomes an unscored, marked Everyone Answers cue", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-ask-"));
  try {
    const input = structuredClone(animalHomes);
    input.tutor = { ...(input.tutor || {}), sttLanguage: "yue" };
    input.scenes.push({ kind: "ask", q: "What do you do first?", answer: "Call back on a number you know.", ask: "What do you do first?", reveal: "Call back first!", seconds: 25 });
    const { script } = validateLessonScript(input);
    (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    let n = 0;
    const voice = async () => {
      const name = `assets/voice/v${n++}.mp3`;
      writeFileSync(path.join(dir, name), "mp3");
      return { file: name, seconds: 2 };
    };
    const built = await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1" });
    const cue = JSON.parse(readFileSync(path.join(dir, "out", "cues.json"), "utf8")).cues.at(-1);
    assert.deepEqual(cue.ask, { question: "What do you do first?", answer: "Call back on a number you know.", seconds: 25 });
    assert.equal(cue.exercise.type, "openanswer");
    assert.equal(cue.exercise.autoclass, true);
    assert.equal(cue.exercise.practice, undefined);
    assert.deepEqual(cue.exercise.items, [{ topic: "What do you do first?", correctAnswer: "Call back on a number you know.", sttLanguage: "yue", timeLimit: 25 }]);
    assert.ok(cue.at < cue.result.at && cue.result.at < built.total);
    assert.match(readFileSync(path.join(dir, "compositions", "ask1.html"), "utf8"), /class="ask-answer">Call back on a number you know.</);
    assert.match(readFileSync(path.join(dir, "compositions", "ask1.html"), "utf8"), /\.ask-answer \{[^}]*text-wrap: balance;/, "no lone last character");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a warm-up ask needs no answer, shows no answer card and tells the page it is a warm-up", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-warmup-"));
  try {
    const input = structuredClone(animalHomes);
    input.scenes.unshift({ kind: "ask", warmup: true, q: "Say hello and your name!", ask: "Say hello and your name!", reveal: "So many voices!" });
    const { script, errors } = validateLessonScript(input);
    assert.deepEqual(errors, []);
    assert.equal(script.scenes[0].warmup, true);
    assert.equal(script.scenes[0].seconds, 15, "a warm-up is quick by default");
    assert.ok(script.scenes[0].answer, "marked against 'any answer counts'");
    // Only true or false; an ordinary ask still needs its answer.
    assert.ok(validateLessonScript({ ...input, scenes: [{ ...input.scenes[0], warmup: "yes" }, ...input.scenes.slice(1)] }).errors.some((e) => /warmup/.test(e.path)));
    assert.ok(validateLessonScript({ ...input, scenes: [{ ...input.scenes[0], warmup: false }, ...input.scenes.slice(1)] }).errors.some((e) => /answer/.test(e.path)));

    (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "voice", "x.mp3"), "mp3");
    const voice = async () => ({ file: "assets/voice/x.mp3", seconds: 2 });
    await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1" });
    const cue = JSON.parse(readFileSync(path.join(dir, "out", "cues.json"), "utf8")).cues[0];
    assert.equal(cue.ask.warmup, true);
    assert.equal(cue.ask.seconds, 15);
    assert.ok(cue.ask.tag);
    const html = readFileSync(path.join(dir, "compositions", "ask1.html"), "utf8");
    assert.doesNotMatch(html, /class="ask-answer"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sharing question (open) needs no answer, shows no answer card and tells the page nobody is marked", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-open-"));
  try {
    const input = structuredClone(animalHomes);
    input.scenes.unshift({ kind: "ask", open: true, q: "Where did you love to go?", ask: "Tell me where you loved to go!", reveal: "Thank you for sharing!", seconds: 40 });
    const { script, errors } = validateLessonScript(input);
    assert.deepEqual(errors, []);
    assert.equal(script.scenes[0].open, true);
    assert.equal(script.scenes[0].seconds, 40, "a sharing question keeps the normal pace");
    assert.ok(script.scenes[0].answer, "marked against nothing: any answer counts");
    assert.ok(validateLessonScript({ ...input, scenes: [{ ...input.scenes[0], open: "yes" }, ...input.scenes.slice(1)] }).errors.some((e) => /open/.test(e.path)));

    (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "voice", "x.mp3"), "mp3");
    const voice = async () => ({ file: "assets/voice/x.mp3", seconds: 2 });
    await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1" });
    const cue = JSON.parse(readFileSync(path.join(dir, "out", "cues.json"), "utf8")).cues[0];
    assert.equal(cue.ask.open, true);
    assert.equal(cue.ask.warmup, undefined);
    assert.ok(cue.ask.tag);
    const html = readFileSync(path.join(dir, "compositions", "ask1.html"), "utf8");
    assert.doesNotMatch(html, /class="ask-answer"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a spell scene becomes a spelling race cue, with blanks in the video until the reveal", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-spell-"));
  try {
    const input = structuredClone(animalHomes);
    input.scenes.push({
      kind: "spell",
      ask: "Spelling race!",
      reveal: "Bird, bee, fish!",
      seconds: 45,
      words: [{ emoji: "🐦", word: "bird", hint: "lives in a nest" }, { emoji: "🐝", word: "bee" }, { emoji: "🐟", word: "fish" }],
    });
    const { script } = validateLessonScript(input);
    (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    let n = 0;
    const voice = async () => {
      const name = `assets/voice/v${n++}.mp3`;
      writeFileSync(path.join(dir, name), "mp3");
      return { file: name, seconds: 2 };
    };
    const built = await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1" });
    const cue = JSON.parse(readFileSync(path.join(dir, "out", "cues.json"), "utf8")).cues.at(-1);
    assert.deepEqual(cue.spell, {
      id: "autoclass-animal-homes-spell2",
      seconds: 45,
      words: [{ word: "bird", emoji: "🐦", hint: "lives in a nest" }, { word: "bee", emoji: "🐝", hint: "" }, { word: "fish", emoji: "🐟", hint: "" }],
    });
    assert.deepEqual(cue.exercise, { id: "autoclass-animal-homes-spell2", type: "spellrace", title: "Animal Homes · Spelling race!" });
    assert.ok(cue.at < cue.result.at && cue.result.at < built.total);
    const html = readFileSync(path.join(dir, "compositions", "spell2.html"), "utf8");
    assert.match(html, /class="spell-blank">_ _ _ _</);
    assert.match(html, /class="spell-answer">bird</);
    assert.match(html, /--cols: 3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    assert.deepEqual(cues.cues.map((c) => (c.poll ? "poll" : c.speak ? "speak" : c.spell ? "spell" : "quiz")), ["speak", "quiz", "poll", "quiz", "spell"]);
    const times = cues.cues.map((c) => c.at);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.ok(cues.cues.every((c) => c.at < built.total));
    assert.equal(cues.cues[1].exercise.type, "mcquiz");
    // Phones see the question (view only) from when its options appear, before the page pauses.
    assert.ok(cues.cues[1].previewAt > 0 && cues.cues[1].previewAt < cues.cues[1].at);
    assert.equal(cues.cues[1].exercise.items[0].options[1].isCorrect, true);
    assert.equal(cues.cues[1].result.wrong[0][0].url, "/uploads/autoclass/animal-homes/r1/analysis/q1-wrong-1-1.mp3");
    assert.equal(cues.tutor.breaks.length, 6);
    assert.equal(cues.tutor.audience, "");
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

test("a teach pair without a repeat line has no say-it-with-me card", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-norepeat-"));
  try {
    const input = structuredClone(animalHomes);
    for (const pair of input.scenes[0].pairs) delete pair.repeat;
    const { script, errors } = validateLessonScript(input);
    assert.deepEqual(errors, []);
    (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    const voiced = [];
    const voice = async (text) => {
      const name = `assets/voice/v${voiced.length}.mp3`;
      voiced.push(text);
      writeFileSync(path.join(dir, name), "mp3");
      return { file: name, seconds: 2 };
    };
    await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1" });
    const teach = readFileSync(path.join(dir, "compositions", "teach1.html"), "utf8");
    assert.doesNotMatch(teach, /Say it with me/);
    assert.match(readFileSync(path.join(dir, "compositions", "teach2.html"), "utf8"), /Say it with me/);
    assert.equal(voiced.includes(animalHomes.scenes[0].pairs[0].repeat), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the video's own labels follow the lesson's language", async () => {
  const build = async (language) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoclass-labels-"));
    try {
      const input = structuredClone(animalHomes);
      input.voice = { ...(input.voice || {}), language };
      input.scenes.push({ kind: "ask", q: "Why?", answer: "Because.", ask: "Why?", reveal: "Because." });
      const { script } = validateLessonScript(input);
      (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
      let n = 0;
      const voice = async () => {
        const name = `assets/voice/v${n++}.mp3`;
        writeFileSync(path.join(dir, name), "mp3");
        return { file: name, seconds: 2 };
      };
      await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1" });
      const read = (id) => readFileSync(path.join(dir, "compositions", `${id}.html`), "utf8");
      return ["teach1", "say1", "quiz1", "ask1", "outro"].map(read).join("\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const english = await build("en-US");
  for (const text of ["Question 1", "Answer on your phone", "Your turn to speak", "Your turn to answer", "Say it with me", "Well done!", "job!"]) assert.ok(english.includes(text), text);
  const cantonese = await build("yue-HK");
  for (const text of ["第 1 題", "用手機作答", "到你講", "到你答", "跟我講", "做得好！"]) assert.ok(cantonese.includes(text), text);
  assert.doesNotMatch(cantonese, /Question \d|Answer on your phone|Your turn|Say it with me|Well done|Great/);
});

test("a quiz with a picture and a clip: panel in the video, clip before the question, picture on the phones", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-media-"));
  try {
    const input = structuredClone(animalHomes);
    input.scenes[2].image = "/uploads/autoclass/_media/hive.jpg";
    input.scenes[2].clip = { src: "/uploads/autoclass/_media/bees.mp3", from: 5, seconds: 10 };
    input.scenes[2].intro = "Listen to this.";
    input.scenes[5].clip = { src: "/uploads/autoclass/_media/bees.mp3", seconds: 4 };
    const { script, errors } = validateLessonScript(input);
    assert.deepEqual(errors, []);
    assert.deepEqual(mediaFiles(script), ["hive.jpg", "bees.mp3"]);

    const fetched = [];
    const fetchImpl = async (url) => {
      fetched.push(url);
      return new Response("bytes");
    };
    const media = await fetchMedia({ dir, baseUrl: "https://class.test/uploads/autoclass/_media", names: mediaFiles(script), fetchImpl });
    assert.deepEqual(fetched, ["https://class.test/uploads/autoclass/_media/hive.jpg", "https://class.test/uploads/autoclass/_media/bees.mp3"]);
    assert.equal(readFileSync(path.join(dir, "assets", "media", "hive.jpg"), "utf8"), "bytes");

    (await import("node:fs")).mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "voice", "x.mp3"), "mp3");
    const voice = async () => ({ file: "assets/voice/x.mp3", seconds: 2 });
    const built = await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1", media });
    const quiz = built.cues.cues.find((c) => c.exercise?.type === "mcquiz");
    assert.equal(quiz.exercise.items[0].image, "/uploads/autoclass/_media/hive.jpg");
    const scene = built.scenes.find((s) => s.id === "quiz1");
    // The class listens first: the intro at 0.6 for 2 s, the clip 0.3 s later for 10 s, then
    // the question (asked 0.6 s after the clip, for 2 s), then the pause.
    const r3 = (x) => Math.round(x * 1000) / 1000;
    const clipAt = 0.6 + 2 + 0.3;
    assert.equal(scene.pauseAt, r3(scene.start + clipAt + 10 + 0.6 + 2 + 0.3));
    assert.equal(script.scenes[2].intro, "Listen to this.");
    const index = readFileSync(path.join(dir, "index.html"), "utf8");
    assert.match(index, new RegExp(`<audio id="clip-1" class="clip" src="assets/media/bees.mp3" data-start="${r3(scene.start + clipAt)}" data-duration="10"[^>]*data-media-start="5"`));
    assert.match(index, /<audio id="clip-2" class="clip" src="assets\/media\/bees.mp3"[^>]*data-duration="4"/);
    const html = readFileSync(path.join(dir, "compositions", "quiz1.html"), "utf8");
    assert.match(html, /<img src="assets\/media\/hive.jpg"/);
    assert.match(html, /class="options options-beside"/);
    assert.match(readFileSync(path.join(dir, "compositions", "quiz2.html"), "utf8"), /quiz-record/);

    await assert.rejects(fetchMedia({ dir, baseUrl: "https://x", names: ["gone.jpg"], fetchImpl: async () => new Response("", { status: 404 }) }), /gone\.jpg.*404/);
    await assert.rejects(buildLesson(mkdtempSync(path.join(tmpdir(), "autoclass-nomedia-")), script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1" }), /no media files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the renderer takes only the media folder as its media URL, and needs it when the script uses media", () => {
  const base = { jobId: "j1", lessonId: "animal-homes", mediaUrl: "/uploads/autoclass/animal-homes/j1", routerBase: "https://r.test" };
  const script = { id: "animal-homes", scenes: [{ kind: "quiz", image: "/uploads/autoclass/_media/a.jpg" }] };
  assert.match(badAutoclassRequest({ ...base, script }), /mediaFilesUrl is missing/);
  assert.match(badAutoclassRequest({ ...base, script, mediaFilesUrl: "https://evil.test/x" }), /not the media folder/);
  assert.equal(badAutoclassRequest({ ...base, script, mediaFilesUrl: "https://class.test/uploads/autoclass/_media" }), "");
});

test("a reveal video plays full size after Tommy gives the answer, before the results pause", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoclass-reveal-"));
  try {
    const input = structuredClone(animalHomes);
    input.scenes[2].revealVideo = { src: "/uploads/autoclass/_media/bees.mp4", from: 3, seconds: 20 };
    const { script, errors } = validateLessonScript(input);
    assert.deepEqual(errors, []);
    assert.deepEqual(mediaFiles(script), ["bees.mp4"]);
    const fs = await import("node:fs");
    fs.mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "voice", "x.mp3"), "mp3");
    const voice = async () => ({ file: "assets/voice/x.mp3", seconds: 2 });
    const media = await fetchMedia({ dir, baseUrl: "https://class.test/uploads/autoclass/_media", names: mediaFiles(script), fetchImpl: async () => new Response("mp4") });
    const built = await buildLesson(dir, script, { voice, mediaUrl: "/uploads/autoclass/animal-homes/r1", media });
    const scene = built.scenes.find((s) => s.id === "quiz1");
    const cue = built.cues.cues.find((c) => c.result?.key === "q1");
    // reveal at pause + 1, Tommy's 2 s answer from +0.1, the video 0.6 s later.
    const videoAt = scene.pauseAt + 1 + 0.1 + 2 + 0.6;
    assert.ok(cue.result.at > videoAt + 20, "the results pause comes after the video");
    const index = readFileSync(path.join(dir, "index.html"), "utf8");
    assert.match(index, new RegExp(`<video id="reveal-video-1" class="clip reveal-video" src="assets/media/bees.mp4" data-start="${Math.round(videoAt * 1000) / 1000}" data-duration="20"[^>]*data-media-start="3" data-has-audio="true"`));
    assert.match(readFileSync(path.join(dir, "compositions", "quiz1.html"), "utf8"), /id="quiz1-adtag"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the see-through render has no background and is announced in cues.json", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "alpha-"));
  try {
    mkdirSync(path.join(dir, "out"), { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<html><head></head><body></body></html>");
    writeFileSync(path.join(dir, "out", "cues.json"), JSON.stringify({ video: "/u/x.mp4" }));
    const logs = [];
    const rendered = [];
    const render = async (job, d, out) => {
      rendered.push(out);
      assert.match(readFileSync(path.join(d, "index.html"), "utf8"), /#ground \{ display: none/);
      writeFileSync(out, "webm");
    };
    await renderSeeThrough({ job: {}, dir, lessonId: "x", mediaUrl: "/u", render, log: (j, m) => logs.push(m) });
    assert.equal(rendered[0], path.join(dir, "out", "x-alpha.webm"));
    assert.equal(JSON.parse(readFileSync(path.join(dir, "out", "cues.json"), "utf8")).videoAlpha, "/u/x-alpha.webm");

    // A failing second render never fails the lesson: no videoAlpha, no half-written file.
    writeFileSync(path.join(dir, "out", "cues.json"), JSON.stringify({ video: "/u/x.mp4" }));
    await renderSeeThrough({ job: {}, dir, lessonId: "x", mediaUrl: "/u", render: async (j, d, out) => { writeFileSync(out, "half"); throw new Error("boom"); }, log: (j, m) => logs.push(m) });
    assert.equal("videoAlpha" in JSON.parse(readFileSync(path.join(dir, "out", "cues.json"), "utf8")), false);
    assert.equal(existsSync(path.join(dir, "out", "x-alpha.webm")), false);
    assert.match(logs.at(-1), /boom/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
