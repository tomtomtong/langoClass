// Class roster shapes from lib/lango-classes.js. newcms returns students with
// several field spellings; rooms keep one shape so names and IDs line up.

export function normalizeStudentList(classItem) {
  const list = classItem?.studentList ?? classItem?.student_list ?? classItem?.students ?? [];
  if (!Array.isArray(list)) return [];
  return list.map(normalizeStudent).filter(Boolean);
}

export function normalizeStudent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = entityId(raw.id ?? raw.studentId);
  const studentCode = pickString(raw.student_id, raw.studentCode);
  const resolvedId = id ?? entityId(studentCode);
  if (resolvedId == null) return null;
  const firstName = pickString(raw.firstName, raw.first_name, raw.givenName, raw.given_name);
  const lastName = pickString(raw.lastName, raw.last_name, raw.familyName, raw.family_name);
  const fullName =
    pickString(raw.fullName, raw.full_name, raw.name_en, raw.name_zh, raw.name, `${firstName} ${lastName}`.trim()) ||
    `Student ${resolvedId}`;
  return {
    id: resolvedId,
    studentCode: studentCode || null,
    username: pickString(raw.username) || null,
    firstName,
    lastName,
    fullName,
  };
}

// Every string a student may type or carry in a join link: their ID, school
// student code, or username. Matching is case-insensitive.
export function studentKeys(student) {
  const keys = new Set();
  for (const value of [student?.id, student?.studentCode, student?.username]) {
    const text = String(value ?? "").trim().toLowerCase();
    if (text) keys.add(text);
  }
  return [...keys];
}

const LEVEL_FIELDS = ["englishLevel", "english_level", "level", "grade", "year", "primaryLevel", "primary_level", "section"];

// newcms class lists come under several keys; the host page reads classList.
export function normalizeClassListResponse(data) {
  const rawList = extractClassList(data);
  return {
    ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}),
    classList: rawList.map(normalizeClassItem).filter(Boolean),
  };
}

export function normalizeClassItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = entityId(raw.id ?? raw.class_id ?? raw.classId);
  if (id == null) return null;
  const name = pickString(raw.name, raw.class_name, raw.className, raw.title, raw.class_id) || `Class ${id}`;
  const studentList = normalizeStudentList(raw);
  const level = pickLevel(raw);
  return {
    id,
    name,
    studentCount: studentCount(raw) ?? (studentList.length || null),
    studentList,
    englishLevel: level,
    level,
    grade: raw.grade != null ? String(raw.grade).trim() : null,
  };
}

function extractClassList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const list of [data.classList, data.classes, data.data?.classList, data.data?.classes, data.result?.classList]) {
    if (Array.isArray(list)) return list;
  }
  return [];
}

function studentCount(raw) {
  for (const list of [raw.students, raw.studentList, raw.student_list]) {
    if (Array.isArray(list)) return list.length;
  }
  const count = raw.student_count ?? raw.studentCount ?? raw.students_count ?? raw.totalStudents ?? raw.total_students ?? raw.numStudents;
  if (count == null || count === "") return null;
  const number = Number(count);
  return Number.isFinite(number) ? number : null;
}

function pickLevel(raw) {
  for (const field of LEVEL_FIELDS) {
    const value = raw?.[field];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  const name = pickString(raw?.name, raw?.class_name, raw?.className, raw?.title);
  const match = name.match(/\b(P[1-6]|S[1-6])\b/i);
  return match ? match[1].toUpperCase() : null;
}

function entityId(raw) {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim();
  if (!text) return null;
  const number = Number(text);
  if (Number.isFinite(number) && String(number) === text) return number;
  return text;
}

function pickString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}
