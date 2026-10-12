const LEVEL_FIELDS = [
  "englishLevel",
  "english_level",
  "level",
  "grade",
  "year",
  "primaryLevel",
  "primary_level",
  "section",
];

function pickString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function pickStudentCount(raw) {
  if (Array.isArray(raw.students)) return raw.students.length;
  if (Array.isArray(raw.studentList)) return raw.studentList.length;
  if (Array.isArray(raw.student_list)) return raw.student_list.length;

  const count =
    raw.student_count ??
    raw.studentCount ??
    raw.students_count ??
    raw.totalStudents ??
    raw.total_students ??
    raw.numStudents;
  if (count == null || count === "") return null;
  const n = Number(count);
  return Number.isFinite(n) ? n : null;
}

function normalizeEntityId(rawId) {
  if (rawId == null || rawId === "") return null;
  const text = String(rawId).trim();
  if (!text) return null;
  const num = Number(text);
  if (Number.isFinite(num) && String(num) === text) return num;
  return text;
}

function normalizeStudent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = normalizeEntityId(raw.id ?? raw.studentId);
  const studentCode = pickString(raw.student_id, raw.studentCode);
  const resolvedId = id ?? normalizeEntityId(studentCode);
  if (resolvedId == null) return null;

  const firstName = pickString(raw.firstName, raw.first_name, raw.givenName, raw.given_name);
  const lastName = pickString(raw.lastName, raw.last_name, raw.familyName, raw.family_name);
  const username = pickString(raw.username);
  const fullName =
    pickString(
      raw.fullName,
      raw.full_name,
      raw.name_en,
      raw.name_zh,
      raw.name,
      `${firstName} ${lastName}`.trim()
    ) || `Student ${resolvedId}`;

  return {
    id: resolvedId,
    studentCode: studentCode || null,
    username: username || null,
    firstName,
    lastName,
    fullName,
  };
}

function normalizeStudentList(raw) {
  const list = raw.studentList ?? raw.student_list ?? raw.students ?? [];
  if (!Array.isArray(list)) return [];
  return list.map(normalizeStudent).filter(Boolean);
}

function pickLevel(raw) {
  for (const field of LEVEL_FIELDS) {
    const value = raw?.[field];
    if (value != null && String(value).trim()) return String(value).trim();
  }

  const name = pickString(raw?.name, raw?.class_name, raw?.className, raw?.title);
  const levelMatch = name.match(/\b(P[1-6]|S[1-6])\b/i);
  if (levelMatch) return levelMatch[1].toUpperCase();

  return null;
}

function normalizeClassItem(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = normalizeEntityId(raw.id ?? raw.class_id ?? raw.classId);
  if (id == null) return null;

  const name =
    pickString(raw.name, raw.class_name, raw.className, raw.title, raw.class_id) ||
    `Class ${id}`;

  const studentCount = pickStudentCount(raw);
  const level = pickLevel(raw);
  const studentList = normalizeStudentList(raw);

  return {
    id,
    name,
    studentCount: studentCount ?? (studentList.length || null),
    studentList,
    englishLevel: level,
    level,
    grade: raw.grade != null ? String(raw.grade).trim() : null,
  };
}

function extractClassListPayload(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.classList)) return data.classList;
  if (Array.isArray(data.classes)) return data.classes;
  if (Array.isArray(data.data?.classList)) return data.data.classList;
  if (Array.isArray(data.data?.classes)) return data.data.classes;
  if (Array.isArray(data.result?.classList)) return data.result.classList;
  return [];
}

function normalizeClassListResponse(data) {
  const rawList = extractClassListPayload(data);
  const classList = rawList.map(normalizeClassItem).filter(Boolean);

  return {
    ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}),
    classList,
  };
}

function findStudentById(studentList, studentId) {
  const id = String(studentId ?? "").trim();
  if (!id) return null;
  const lower = id.toLowerCase();
  return (Array.isArray(studentList) ? studentList : []).find((student) => {
    if (String(student.id) === id) return true;
    if (student.studentCode && String(student.studentCode) === id) return true;
    if (student.username && String(student.username).toLowerCase() === lower) return true;
    return false;
  });
}

function normalizeStudentListResponse(students) {
  if (!Array.isArray(students)) return [];
  return students.map(normalizeStudent).filter(Boolean);
}

module.exports = {
  normalizeClassItem,
  normalizeClassListResponse,
  extractClassListPayload,
  findStudentById,
  normalizeEntityId,
  normalizeStudentListResponse,
};
