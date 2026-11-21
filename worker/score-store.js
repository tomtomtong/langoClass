// Exercise scores in D1. Rows share the record shape of lib/score-store.js so
// /api/scores can merge them with the older student-scores document.

export async function saveScoreBatch(db, batch, savedAt = new Date().toISOString()) {
  const teacherId = idOf(batch?.teacherId);
  // A class ID may be text (e.g. "Demo"); class_id keeps it as given.
  const classId = idOf(batch?.classId);
  const exerciseId = exerciseIdOf(batch?.exerciseId);
  const roomId = String(batch?.roomId || "");
  if (teacherId == null || classId == null || exerciseId == null || !roomId || !Array.isArray(batch.scores)) {
    const skipped = Array.isArray(batch?.scores) ? batch.scores.length : 0;
    return { saved: 0, skipped, rejected: "teacherId, classId, exerciseId and roomId are required" };
  }

  const records = [];
  for (const entry of batch.scores) {
    const studentUserId = String(entry?.studentUserId || "").trim();
    if (!studentUserId) continue;
    records.push({
      recordKey: recordKey(teacherId, classId, roomId, exerciseId, studentUserId),
      teacherId,
      classId,
      courseId: batch.courseId != null && Number.isFinite(Number(batch.courseId)) ? Number(batch.courseId) : null,
      exerciseId,
      exerciseTitle: String(batch.exerciseTitle || "").slice(0, 120),
      exerciseType: String(batch.exerciseType || "mcquiz").slice(0, 40),
      roomId,
      studentUserId,
      displayName: String(entry.displayName || "").trim().slice(0, 80),
      score: Math.max(0, Number(entry.score) || 0),
      savedAt,
    });
  }
  if (!records.length) return { saved: 0, skipped: batch.scores.length };

  const insert = db.prepare(
    "INSERT OR IGNORE INTO score_records (record_key, teacher_id, class_id, saved_at, body) VALUES (?, ?, ?, ?, ?)"
  );
  const results = await db.batch(
    records.map((record) =>
      insert.bind(record.recordKey, String(teacherId), classId, savedAt, JSON.stringify(record))
    )
  );
  const saved = results.reduce((sum, result) => sum + (Number(result?.meta?.changes) || 0), 0);
  return { saved, skipped: batch.scores.length - saved };
}

export async function readScoreRecords(db, teacherId, classId) {
  let rows;
  try {
    ({ results: rows } = await db
      .prepare("SELECT body FROM score_records WHERE teacher_id = ? AND class_id = ? ORDER BY saved_at DESC")
      .bind(String(idOf(teacherId)), idOf(classId))
      .all());
  } catch (error) {
    // Until migration 0002 runs, keep serving the older document scores.
    if (!/no such table/i.test(error instanceof Error ? error.message : String(error))) throw error;
    console.error(JSON.stringify({ message: "score_records_missing" }));
    return [];
  }
  const records = [];
  for (const row of rows || []) {
    try {
      records.push(JSON.parse(row.body));
    } catch {
      /* skip a damaged row */
    }
  }
  return records;
}

export function recordKey(teacherId, classId, roomId, exerciseId, studentUserId) {
  return `${idOf(teacherId)}:${idOf(classId)}:${String(roomId)}:${exerciseIdOf(exerciseId)}:${String(studentUserId)}`;
}

// Course exercises have number ids; autoclass ones are text ("autoclass-animal-homes-q1"), made
// from the lesson id. A number stays a number, so older record keys are unchanged.
const TEXT_EXERCISE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function exerciseIdOf(value) {
  const id = idOf(value);
  if (typeof id === "number") return id;
  return id != null && TEXT_EXERCISE_ID.test(id) ? id : null;
}

function idOf(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}
