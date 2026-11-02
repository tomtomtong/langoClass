import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { readScoreRecords, saveScoreBatch } from "./score-store.js";

// A D1-shaped wrapper over node:sqlite with the checked-in migrations applied.
function d1({ migrate = true } = {}) {
  const db = new DatabaseSync(":memory:");
  if (migrate) {
    for (const file of ["0001_stores.sql", "0002_score_records.sql"]) {
      db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
  }
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    batch: async (statements) => Promise.all(statements.map((item) => item.run())),
  };
}

function batch(scores, extra = {}) {
  return {
    teacherId: 835,
    classId: 62,
    courseId: 7,
    exerciseId: 11,
    exerciseTitle: "Animals",
    exerciseType: "mcquiz",
    roomId: "123456",
    scores,
    ...extra,
  };
}

test("a retried batch does not count a score twice", async () => {
  const db = d1();
  const first = await saveScoreBatch(db, batch([
    { studentUserId: "ada", displayName: "Ada", score: 600 },
    { studentUserId: "bo", displayName: "Bo", score: 300 },
  ]), "2026-10-21T01:00:00.000Z");
  assert.deepEqual(first, { saved: 2, skipped: 0 });

  const again = await saveScoreBatch(db, batch([
    { studentUserId: "ada", displayName: "Ada", score: 900 },
    { studentUserId: "bo", displayName: "Bo", score: 300 },
  ]), "2026-10-21T02:00:00.000Z");
  assert.deepEqual(again, { saved: 0, skipped: 2 });

  const records = await readScoreRecords(db, 835, 62);
  assert.equal(records.length, 2);
  const ada = records.find((record) => record.studentUserId === "ada");
  assert.equal(ada.score, 600);
  assert.equal(ada.recordKey, "835:62:123456:11:ada");
  assert.equal(ada.savedAt, "2026-10-21T01:00:00.000Z");
});

test("a batch without teacher, class, or exercise saves nothing", async () => {
  const db = d1();
  assert.equal((await saveScoreBatch(db, batch([{ studentUserId: "ada", score: 1 }], { classId: null }))).saved, 0);
  assert.equal((await saveScoreBatch(db, batch([{ studentUserId: "ada", score: 1 }], { exerciseId: undefined }))).saved, 0);
  assert.equal((await readScoreRecords(db, 835, 62)).length, 0);
});

test("reads fall back to no rows before the migration runs", async () => {
  assert.deepEqual(await readScoreRecords(d1({ migrate: false }), 835, 62), []);
});

test("/api/scores returns room scores together with the older document", async () => {
  const db = d1();
  db.raw
    .prepare("INSERT INTO documents (name, body, updated_at) VALUES (?, ?, ?)")
    .run(
      "student-scores",
      JSON.stringify({
        students: { "835:62:ada": { teacherId: 835, classId: 62, studentUserId: "ada", displayName: "Ada" } },
        records: [{
          recordKey: "835:62:654321:3:ada",
          teacherId: 835,
          classId: 62,
          courseId: 7,
          exerciseId: 3,
          roomId: "654321",
          studentUserId: "ada",
          displayName: "Ada",
          score: 200,
          savedAt: "2026-10-01T01:00:00.000Z",
        }],
      }),
      "2026-10-01T01:00:00.000Z"
    );
  await saveScoreBatch(db, batch([
    { studentUserId: "ada", displayName: "Ada", score: 600 },
    { studentUserId: "bo", displayName: "Bo", score: 300 },
  ]), "2026-10-21T01:00:00.000Z");
  await saveScoreBatch(db, batch([{ studentUserId: "cy", displayName: "Cy", score: 900 }], { classId: 579 }));

  const env = { DB: db };
  const login = await handleStoreApi(
    new Request("https://class.lango.ai/api/lango/login", {
      method: "POST",
      body: JSON.stringify({ login: "lango-developer-alex", password: "lango123" }),
    }),
    env,
    new URL("https://class.lango.ai/api/lango/login")
  );
  const { token } = await login.json();
  const url = new URL("https://class.lango.ai/api/scores?classId=62");
  const response = await handleStoreApi(
    new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
    env,
    url
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.deepEqual(body.scores.map((record) => record.recordKey).sort(), [
    "835:62:123456:11:ada",
    "835:62:123456:11:bo",
    "835:62:654321:3:ada",
  ]);
  assert.equal(body.scores.at(-1).recordKey, "835:62:654321:3:ada");
  assert.deepEqual(
    body.semesterTotals.map((student) => [student.studentUserId, student.totalScore, student.exerciseCount]),
    [["ada", 800, 2], ["bo", 300, 1]]
  );
});

test("a class named with text, like Demo, saves and reads its scores", async () => {
  const db = d1();
  const teacherId = "cc2752492bf7497899ce0b97e5dee288";
  const result = await saveScoreBatch(db, batch([{ studentUserId: "ada", displayName: "Ada", score: 300 }], { teacherId, classId: "Demo" }));
  assert.deepEqual(result, { saved: 1, skipped: 0 });
  const records = await readScoreRecords(db, teacherId, "Demo");
  assert.deepEqual(records.map((record) => [record.recordKey, record.classId]), [[`${teacherId}:Demo:123456:11:ada`, "Demo"]]);
  assert.deepEqual(await readScoreRecords(db, teacherId, 62), []);
});

test("scores and host progress work for a text class ID", async () => {
  const db = d1();
  await saveScoreBatch(db, batch([{ studentUserId: "ada", displayName: "Ada", score: 300 }], { classId: "Demo" }));
  const env = { DB: db };
  const loginUrl = new URL("https://class.lango.ai/api/lango/login");
  const login = await handleStoreApi(
    new Request(loginUrl, { method: "POST", body: JSON.stringify({ login: "lango-developer-alex", password: "lango123" }) }),
    env,
    loginUrl
  );
  const { token } = await login.json();
  const call = async (path, init = {}) => {
    const url = new URL(`https://class.lango.ai${path}`);
    const response = await handleStoreApi(
      new Request(url, { ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" } }),
      env,
      url
    );
    return { status: response.status, body: await response.json() };
  };

  const scores = await call("/api/scores?classId=Demo");
  assert.equal(scores.status, 200);
  assert.deepEqual(scores.body.semesterTotals.map((student) => [student.studentUserId, student.totalScore]), [["ada", 300]]);

  const saved = await call("/api/host/progress", {
    method: "PUT",
    body: JSON.stringify({ classId: "Demo", courseId: 7, completedExerciseIds: [11], lastSectionId: 2 }),
  });
  assert.equal(saved.status, 200);
  const read = await call("/api/host/progress?classId=Demo&courseId=7");
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.progress.completedExerciseIds, [11]);
  assert.equal(read.body.progress.lastSectionId, 2);

  const dashboard = await call("/api/cms/dashboard/progress?classId=Demo");
  assert.equal(dashboard.status, 200);
});
