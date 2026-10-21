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
