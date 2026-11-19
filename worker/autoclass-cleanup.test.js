import assert from "node:assert/strict";
import test from "node:test";
import { GRACE_MS, cleanAllRenders, cleanLessonRenders } from "./autoclass-cleanup.js";
import { publishRender, readLesson, writeLesson } from "./autoclass-lessons.js";
import { memoryD1, memoryR2 } from "./test-env.js";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-19T12:00:00Z");
const id = (n) => String(n).repeat(32).slice(0, 32); // a render id: 32 hex digits
const [PUBLISHED, RETIRED_NEW, RETIRED_OLD, ORPHAN_OLD, ORPHAN_NEW] = [1, 2, 3, 4, 5].map(id);

async function setup() {
  const env = { DB: memoryD1(), UPLOADS: memoryR2() };
  const put = async (key, ageMs) => {
    await env.UPLOADS.put(key, "x");
    env.UPLOADS.objects.get(key).uploaded = new Date(NOW - ageMs);
  };
  for (const [render, age] of [[PUBLISHED, 30 * HOUR], [RETIRED_NEW, 40 * HOUR], [RETIRED_OLD, 50 * HOUR], [ORPHAN_OLD, 7 * HOUR], [ORPHAN_NEW, 1 * HOUR]]) {
    for (const name of ["animal-homes.mp4", "cues.json", "analysis/an-leadIn-1.mp3"]) await put(`uploads/autoclass/animal-homes/${render}/${name}`, age);
  }
  // Things that are not render folders of this lesson.
  await put("uploads/autoclass/animal-homes/notes/readme.json", 100 * HOUR);
  await put("uploads/autoclass/animal-homes/stray.mp3", 100 * HOUR);
  await put(`uploads/autoclass/animal-homes-2/${ORPHAN_OLD}/cues.json`, 100 * HOUR);
  await put("uploads/autoclass/_voice/abc.mp3", 100 * HOUR);
  await writeLesson(env, {
    id: "animal-homes",
    teacherId: 835,
    script: {},
    published: { renderId: PUBLISHED },
    retired: [
      { renderId: RETIRED_NEW, at: new Date(NOW - 2 * HOUR).toISOString() },
      { renderId: RETIRED_OLD, at: new Date(NOW - 7 * HOUR).toISOString() },
      { renderId: id(9), at: new Date(NOW - 7 * HOUR).toISOString() }, // its folder is already gone
    ],
  });
  return env;
}

const left = (env) => [...env.UPLOADS.objects.keys()].sort();

test("only renders nobody can be playing are removed", async () => {
  const env = await setup();
  const result = await cleanLessonRenders(env, "animal-homes", { now: NOW });
  assert.deepEqual(result.deleted.sort(), [RETIRED_OLD, ORPHAN_OLD].sort());
  assert.deepEqual(result.kept.sort(), [PUBLISHED, RETIRED_NEW, ORPHAN_NEW].sort());
  assert.equal(result.files, 6);
  const keys = left(env);
  assert.ok(keys.some((k) => k.includes(`/${PUBLISHED}/`)), "the published render stays, however old");
  assert.ok(keys.some((k) => k.includes(`/${RETIRED_NEW}/`)), "replaced 2 h ago: a class may still be on it");
  assert.ok(keys.some((k) => k.includes(`/${ORPHAN_NEW}/`)), "never published, but written 1 h ago");
  assert.ok(!keys.some((k) => k.includes(`animal-homes/${RETIRED_OLD}/`)));
  assert.ok(!keys.some((k) => k.includes(`animal-homes/${ORPHAN_OLD}/`)));
  for (const key of ["uploads/autoclass/animal-homes/notes/readme.json", "uploads/autoclass/animal-homes/stray.mp3", `uploads/autoclass/animal-homes-2/${ORPHAN_OLD}/cues.json`, "uploads/autoclass/_voice/abc.mp3"]) {
    assert.ok(keys.includes(key), `${key} is not a render folder of this lesson`);
  }
  const lesson = await readLesson(env, "animal-homes");
  assert.deepEqual(lesson.retired.map((r) => r.renderId), [RETIRED_NEW], "removed and missing renders are forgotten");
});

test("a second run removes nothing more", async () => {
  const env = await setup();
  await cleanLessonRenders(env, "animal-homes", { now: NOW });
  const again = await cleanLessonRenders(env, "animal-homes", { now: NOW });
  assert.deepEqual(again.deleted, []);
});

test("once the grace time has passed, the recently replaced render goes too", async () => {
  const env = await setup();
  const later = await cleanLessonRenders(env, "animal-homes", { now: NOW + GRACE_MS });
  assert.ok(later.deleted.includes(RETIRED_NEW));
  assert.ok(later.kept.includes(PUBLISHED));
});

test("a file with no upload time keeps its render", async () => {
  const env = await setup();
  delete env.UPLOADS.objects.get(`uploads/autoclass/animal-homes/${ORPHAN_OLD}/cues.json`).uploaded;
  const result = await cleanLessonRenders(env, "animal-homes", { now: NOW });
  assert.ok(result.kept.includes(ORPHAN_OLD));
});

test("publishing a new render retires the old one", async () => {
  const env = { DB: memoryD1(), UPLOADS: memoryR2() };
  await writeLesson(env, { id: "fish", teacherId: 835, script: {} });
  await publishRender(env, "fish", { renderId: id(1), startedAt: 1 });
  assert.equal((await readLesson(env, "fish")).retired, undefined);
  await publishRender(env, "fish", { renderId: id(2), startedAt: 2 });
  await publishRender(env, "fish", { renderId: id(3), startedAt: 3 });
  const lesson = await readLesson(env, "fish");
  assert.equal(lesson.published.renderId, id(3));
  assert.deepEqual(lesson.retired.map((r) => r.renderId), [id(1), id(2)]);
  assert.ok(Date.parse(lesson.retired[0].at) > 0);
});

test("the hourly run cleans every lesson", async () => {
  const env = await setup();
  await writeLesson(env, { id: "animal-homes-2", teacherId: 835, script: {} });
  await writeLesson(env, { id: "empty", teacherId: 835, script: {} });
  const summary = await cleanAllRenders(env, { now: NOW });
  assert.deepEqual(summary, { lessons: 3, deleted: 3, files: 7, failed: 0 });
  assert.equal(await env.UPLOADS.get(`uploads/autoclass/animal-homes-2/${ORPHAN_OLD}/cues.json`), null, "never published and old");
});
