const fs = require("fs");
const paths = require("./paths");

const DATA_FILE = paths.hostProgressFile;

function ensureDataFile() {
  paths.ensurePersistentDirs();
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ records: [] }, null, 2), "utf8");
  }
}

function readStore() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

function writeStore(store) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function progressKey(teacherId, classId, courseId) {
  return `${Number(teacherId)}:${Number(classId)}:${Number(courseId)}`;
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
}

function emptyProgress(teacherId, classId, courseId) {
  return {
    teacherId: Number(teacherId),
    classId: Number(classId),
    courseId: Number(courseId),
    completedExerciseIds: [],
    visitedSectionIds: [],
    lastSectionId: null,
    lastExerciseId: null,
    updatedAt: new Date().toISOString(),
  };
}

function getProgress(teacherId, classId, courseId) {
  const store = readStore();
  const key = progressKey(teacherId, classId, courseId);
  const record = store.records.find(
    (entry) => progressKey(entry.teacherId, entry.classId, entry.courseId) === key
  );
  if (!record) return emptyProgress(teacherId, classId, courseId);
  return {
    ...emptyProgress(teacherId, classId, courseId),
    ...record,
    completedExerciseIds: normalizeIds(record.completedExerciseIds),
    visitedSectionIds: normalizeIds(record.visitedSectionIds),
    lastSectionId: record.lastSectionId ?? null,
    lastExerciseId: record.lastExerciseId ?? null,
  };
}

function upsertProgress(teacherId, classId, courseId, patch = {}) {
  const store = readStore();
  const key = progressKey(teacherId, classId, courseId);
  let record = store.records.find(
    (entry) => progressKey(entry.teacherId, entry.classId, entry.courseId) === key
  );

  if (!record) {
    record = emptyProgress(teacherId, classId, courseId);
    store.records.push(record);
  }

  if (patch.completedExerciseIds != null) {
    record.completedExerciseIds = normalizeIds([
      ...(record.completedExerciseIds || []),
      ...patch.completedExerciseIds,
    ]);
  }
  if (patch.visitedSectionIds != null) {
    record.visitedSectionIds = normalizeIds([
      ...(record.visitedSectionIds || []),
      ...patch.visitedSectionIds,
    ]);
  }
  if (patch.lastSectionId !== undefined) {
    record.lastSectionId = patch.lastSectionId == null ? null : Number(patch.lastSectionId);
  }
  if (patch.lastExerciseId !== undefined) {
    record.lastExerciseId = patch.lastExerciseId == null ? null : Number(patch.lastExerciseId);
  }

  record.updatedAt = new Date().toISOString();
  writeStore(store);
  return getProgress(teacherId, classId, courseId);
}


function listProgressForClass(teacherId, classId) {
  const tid = Number(teacherId);
  const cid = Number(classId);
  const store = readStore();
  return store.records
    .filter((entry) => entry.teacherId === tid && entry.classId === cid)
    .map((record) => ({
      ...emptyProgress(tid, cid, record.courseId),
      ...record,
      completedExerciseIds: normalizeIds(record.completedExerciseIds),
      visitedSectionIds: normalizeIds(record.visitedSectionIds),
      lastSectionId: record.lastSectionId ?? null,
      lastExerciseId: record.lastExerciseId ?? null,
    }));
}

function deleteProgressForTeacherCourses(teacherId, courseIds) {
  const tid = Number(teacherId);
  const idSet = new Set((courseIds || []).map((id) => Number(id)));
  if (!idSet.size) return { removed: 0 };

  const store = readStore();
  const before = store.records.length;
  store.records = store.records.filter(
    (record) => record.teacherId !== tid || !idSet.has(Number(record.courseId))
  );
  writeStore(store);
  return { removed: before - store.records.length };
}

module.exports = {
  getProgress,
  upsertProgress,
  emptyProgress,
  listProgressForClass,
  deleteProgressForTeacherCourses,
};
