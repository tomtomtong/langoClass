// Shared D1 document storage and course shapes for the Worker handlers.
import { developerAuth } from "./dev-account.js";

const CMS_BASE_DEFAULT = "https://newcms.lango.ai";

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
  const checked = await fetch(`${base}/api/teachers/${encodeURIComponent(String(teacherId))}/classes`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!checked.ok) return json({ message: "Invalid or expired token." }, 401);
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

export function normalizeClassIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((id) => {
      if (id == null || id === "") return null;
      const text = String(id).trim();
      if (!text) return null;
      const num = Number(text);
      return Number.isFinite(num) ? num : text;
    })
    .filter((id) => id != null);
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
