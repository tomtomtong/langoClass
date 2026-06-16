const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "student-scores.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ students: {}, records: [] }, null, 2),
      "utf8"
    );
  }
}

function readStore() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return {
      students:
        parsed.students && typeof parsed.students === "object" ? parsed.students : {},
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return { students: {}, records: [] };
  }
}

function writeStore(store) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function studentKey(teacherId, classId, studentUserId) {
  return `${Number(teacherId)}:${Number(classId)}:${String(studentUserId)}`;
}

function recordKey(teacherId, classId, roomId, exerciseId, studentUserId) {
  return `${Number(teacherId)}:${Number(classId)}:${String(roomId)}:${Number(exerciseId)}:${String(studentUserId)}`;
}

function totalsFromRecords(store, teacherId, classId, studentUserId) {
  const tid = Number(teacherId);
  const cid = Number(classId);
  const uid = String(studentUserId);
  let totalScore = 0;
  let exerciseCount = 0;
  let firstScoreAt = null;
  let lastScoreAt = null;

  for (const record of store.records) {
    if (record.teacherId !== tid || record.classId !== cid || record.studentUserId !== uid) {
      continue;
    }
    totalScore += Math.max(0, Number(record.score) || 0);
    exerciseCount += 1;
    if (!firstScoreAt || record.savedAt < firstScoreAt) firstScoreAt = record.savedAt;
    if (!lastScoreAt || record.savedAt > lastScoreAt) lastScoreAt = record.savedAt;
  }

  return { totalScore, exerciseCount, firstScoreAt, lastScoreAt };
}

function enrichStudent(store, student, key) {
  const [teacherId, classId, studentUserId] = key.split(":");
  const computed = totalsFromRecords(store, teacherId, classId, studentUserId);

  return {
    ...student,
    totalScore: computed.totalScore,
    exerciseCount: computed.exerciseCount,
    firstScoreAt: computed.firstScoreAt,
    lastScoreAt: computed.lastScoreAt,
  };
}

function addExerciseToStudent(store, { teacherId, classId, studentUserId, displayName, score }) {
  const key = studentKey(teacherId, classId, studentUserId);
  const existing = store.students[key];
  const now = new Date().toISOString();
  const points = Math.max(0, Number(score) || 0);

  store.students[key] = {
    teacherId: Number(teacherId),
    classId: Number(classId),
    studentUserId: String(studentUserId),
    displayName: String(displayName || existing?.displayName || "").slice(0, 80),
    totalScore: Math.max(0, (existing?.totalScore ?? 0) + points),
    exerciseCount: (existing?.exerciseCount ?? 0) + 1,
    firstScoreAt: existing?.firstScoreAt || now,
    lastScoreAt: now,
    updatedAt: now,
  };
}

/**
 * Persist final exercise scores for students in a class session.
 * Each record is unique per teacher + class + room + exercise + student.
 * Running semester totals are accumulated on each student profile.
 */
function saveExerciseScores({
  teacherId,
  classId,
  courseId,
  exerciseId,
  exerciseTitle,
  exerciseType,
  roomId,
  scores,
}) {
  if (!teacherId || !classId || !exerciseId || !roomId || !Array.isArray(scores)) {
    return { saved: 0, skipped: 0, error: "Missing required fields." };
  }

  const store = readStore();
  const existingKeys = new Set(store.records.map((r) => r.recordKey));
  let saved = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const entry of scores) {
    const studentUserId = String(entry.studentUserId || "").trim();
    if (!studentUserId) {
      skipped += 1;
      continue;
    }

    const key = recordKey(teacherId, classId, roomId, exerciseId, studentUserId);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }

    const displayName = String(entry.displayName || "").trim().slice(0, 80);
    const score = Math.max(0, Number(entry.score) || 0);

    store.records.push({
      recordKey: key,
      teacherId: Number(teacherId),
      classId: Number(classId),
      courseId: courseId != null ? Number(courseId) : null,
      exerciseId: Number(exerciseId),
      exerciseTitle: String(exerciseTitle || "").slice(0, 120),
      exerciseType: String(exerciseType || "mcquiz").slice(0, 40),
      roomId: String(roomId),
      studentUserId,
      displayName,
      score,
      savedAt: now,
    });
    existingKeys.add(key);

    addExerciseToStudent(store, {
      teacherId,
      classId,
      studentUserId,
      displayName,
      score,
    });
    saved += 1;
  }

  writeStore(store);
  return { saved, skipped };
}

function listScoresForClass(teacherId, classId, { courseId, exerciseId, roomId } = {}) {
  const store = readStore();
  const tid = Number(teacherId);
  const cid = Number(classId);

  return store.records
    .filter((record) => {
      if (record.teacherId !== tid || record.classId !== cid) return false;
      if (courseId != null && record.courseId !== Number(courseId)) return false;
      if (exerciseId != null && record.exerciseId !== Number(exerciseId)) return false;
      if (roomId && record.roomId !== String(roomId)) return false;
      return true;
    })
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

function listStudentsForClass(teacherId, classId) {
  const store = readStore();
  const prefix = `${Number(teacherId)}:${Number(classId)}:`;

  return Object.entries(store.students)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, student]) => enrichStudent(store, student, key))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Semester leaderboard — accumulated totals per student in a class. */
function listSemesterTotalsForClass(teacherId, classId) {
  return listStudentsForClass(teacherId, classId).sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.displayName.localeCompare(b.displayName);
  });
}

module.exports = {
  saveExerciseScores,
  listScoresForClass,
  listStudentsForClass,
  listSemesterTotalsForClass,
  studentKey,
  recordKey,
};
