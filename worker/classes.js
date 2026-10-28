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
