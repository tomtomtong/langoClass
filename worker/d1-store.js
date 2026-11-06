// Shared D1 document storage and course shapes for the Worker handlers.
import { developerAuth } from "./dev-account.js";

const CMS_BASE_DEFAULT = "https://newcms.lango.ai";

// Tokens the Lango CMS accepted recently, so one page load that makes several
// API calls checks the token once. Only successes are kept.
const VERIFIED_TTL_MS = 60_000;
const VERIFIED_MAX = 500;
const verifiedTeachers = new Map();

function recentlyVerified(key) {
  const expires = verifiedTeachers.get(key);
  if (expires == null) return false;
  if (expires > Date.now()) return true;
  verifiedTeachers.delete(key);
  return false;
}

function rememberVerified(key) {
  if (verifiedTeachers.size >= VERIFIED_MAX) verifiedTeachers.delete(verifiedTeachers.keys().next().value);
  verifiedTeachers.set(key, Date.now() + VERIFIED_TTL_MS);
}

function cmsUnavailable(status) {
  console.error(JSON.stringify({ message: "teacher_check_unavailable", status }));
  return json({ message: "Lango CMS is not responding. Please try again in a moment." }, 503);
}

// An admin can open a teacher's CMS to look (the admin portal's "View as"). The
// token is the admin's own, so the role is checked here, on the server: an admin
// token may only read, whatever the page in the browser tries to do.
const adminChecked = new Map();

async function isAdminToken(base, token) {
  const key = `${base}\n${token}`;
  const hit = adminChecked.get(key);
  if (hit && hit.expires > Date.now()) return hit.admin;
  let admin = false;
  try {
    const res = await fetch(`${base}/api/me`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      if (res.status >= 500 || res.status === 408 || res.status === 429) return null;
    } else {
      const data = await res.json().catch(() => null);
      admin = String((data?.user || data)?.role || "").toLowerCase() === "admin";
    }
  } catch {
    return null;
  }
  if (adminChecked.size >= VERIFIED_MAX) adminChecked.delete(adminChecked.keys().next().value);
  adminChecked.set(key, { admin, expires: Date.now() + VERIFIED_TTL_MS });
  return admin;
}

export async function requireTeacher(request, env) {
  const dev = await developerAuth(request);
  if (dev) return dev;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header.trim();
  if (!token) return json({ message: "Missing auth token." }, 401);
  const raw = request.headers.get("x-teacher-id");
  if (raw == null || !String(raw).trim()) return json({ message: "Missing teacher id." }, 400);
  const text = String(raw).trim();
  const numeric = Number(text);
  const teacherId = Number.isInteger(numeric) && numeric > 0 ? numeric : text;
  const base = String(env.CMS_API_BASE || CMS_BASE_DEFAULT).replace(/\/$/, "");
  const key = `${base}\n${teacherId}\n${token}`;
  if (!recentlyVerified(key)) {
    let checked;
    try {
      checked = await fetch(`${base}/api/teachers/${encodeURIComponent(String(teacherId))}/classes`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
    } catch {
      return cmsUnavailable(null);
    }
    // Only a refusal from the CMS means the login is bad; an outage or rate
    // limit is not the teacher's token expiring.
    if (!checked.ok) {
      if (checked.status >= 500 || checked.status === 408 || checked.status === 429) return cmsUnavailable(checked.status);
      return json({ message: "Invalid or expired token." }, 401);
    }
    rememberVerified(key);
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const admin = await isAdminToken(base, token);
    if (admin === null) return cmsUnavailable(null);
    if (admin) return json({ message: "View only: an admin can look at a teacher's account but not change it." }, 403);
  }
  return { token, teacherId };
}

export async function readDoc(env, name, fallback) {
  const row = await env.DB.prepare("SELECT body FROM documents WHERE name = ?").bind(name).first();
  if (!row?.body) return structuredClone(fallback);
  try {
    return JSON.parse(row.body);
  } catch {
    return structuredClone(fallback);
  }
}

export async function writeDoc(env, name, value) {
  await env.DB.prepare(
    "INSERT INTO documents (name, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at"
  )
    .bind(name, JSON.stringify(value), new Date().toISOString())
    .run();
}

export function courseDetail(course) {
  const sections = [...(course.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  return {
    success: true,
    course: {
      id: course.id,
      name: course.name,
      banner: course.banner || null,
      langCode: course.langCode || "en",
      description: course.description || "",
      classIds: normalizeClassIds(course.classIds),
      level: course.level || "",
      estimatedMinutes: course.estimatedMinutes || null,
      objectives: course.objectives || [],
      authorNotes: course.authorNotes || "",
      plannedStart: course.plannedStart || "",
      plannedEnd: course.plannedEnd || "",
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      sourceCommunityId: course.sourceCommunityId || null,
      communityListingId: course.communityListingId || null,
      communityPublishedAt: course.communityPublishedAt || null,
      communityFeatured: Boolean(course.communityFeatured),
    },
    sections: sections.map((section) => ({
      ...section,
      exercises: (section.exercises || []).map((exercise) => ({ ...exercise })),
    })),
  };
}

export function nextCourseId(store) {
  const ids = (store.courses || []).map((course) => course.id).filter((id) => typeof id === "number");
  const minId = ids.length ? Math.min(...ids) : 0;
  return minId <= 0 ? minId - 1 : -1;
}

export function nextNumericId(ids, start) {
  const numbers = ids.filter((id) => typeof id === "number");
  return numbers.length ? Math.max(...numbers) + 1 : start;
}

export function countExercises(course) {
  return (course.sections || []).reduce((sum, section) => sum + (section.exercises || []).length, 0);
}

// A class ID as newcms gives it: a number when it reads as one, otherwise
// the trimmed text (some schools name classes, e.g. "Demo"); null if blank.
export function classIdOf(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : text;
}

export function normalizeClassIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = value.map(classIdOf).filter((id) => id != null);
  return [...new Set(ids)];
}

export function sameId(left, right) {
  return String(left) === String(right);
}

export function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

export async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}

export function json(data, status = 200) {
  return Response.json(data, { status });
}

// Writes several documents in one D1 batch, so a course and its community
// listing change together.
export async function writeDocs(env, entries) {
  const now = new Date().toISOString();
  const statement = env.DB.prepare(
    "INSERT INTO documents (name, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at"
  );
  await env.DB.batch(entries.map(([name, value]) => statement.bind(name, JSON.stringify(value), now)));
}

export function newCourse(store, teacherId, payload, now = new Date().toISOString()) {
  return {
    id: nextCourseId(store),
    teacherId,
    name: clip(payload.name || "Untitled course", 120),
    description: clip(payload.description || "", 500),
    banner: clip(payload.banner || "", 500),
    langCode: clip(payload.langCode || "en", 8),
    classIds: normalizeClassIds(payload.classIds),
    sourceCommunityId: payload.sourceCommunityId != null ? Number(payload.sourceCommunityId) || null : null,
    communityListingId: null,
    communityPublishedAt: null,
    communityFeatured: false,
    sections: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Gives new sections and exercises numeric ids and sets their order.
export function numberSections(incoming) {
  const sections = Array.isArray(incoming) ? incoming : [];
  let nextSection = nextNumericId(sections.map((section) => section.id), 1);
  let nextExercise = nextNumericId(
    sections.flatMap((section) => (section.exercises || []).map((exercise) => exercise.id)),
    1
  );
  return sections.map((raw, index) => {
    const section = { ...raw };
    if (typeof section.id !== "number") {
      section.id = nextSection;
      nextSection += 1;
    }
    section.order = index + 1;
    section.exercises = (section.exercises || []).map((rawExercise, exerciseIndex) => {
      const exercise = { ...rawExercise };
      if (typeof exercise.id !== "number") {
        exercise.id = nextExercise;
        nextExercise += 1;
      }
      exercise.order = exerciseIndex + 1;
      return exercise;
    });
    return section;
  });
}
