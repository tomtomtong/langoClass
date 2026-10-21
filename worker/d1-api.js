import { developerAuth, developerClassList, developerLogin } from "./dev-account.js";
import { readScoreRecords } from "./score-store.js";

const CMS_BASE_DEFAULT = "https://newcms.lango.ai";

export async function handleStoreApi(request, env, url) {
  if (!env.DB) return null;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "POST" && pathname === "/api/lango/login") {
    return developerLogin(request);
  }
  if (method === "GET" && pathname === "/api/lango/classList") {
    return developerClassList(request);
  }

  if (method === "GET" && pathname === "/api/cms/courses") {
    return listCourses(request, env, url);
  }
  if (method === "POST" && pathname === "/api/cms/courses") {
    return createCourse(request, env);
  }
  const sections = pathname.match(/^\/api\/cms\/courses\/(-?\d+)\/sections$/);
  if (sections && method === "PUT") {
    return saveSections(request, env, Number(sections[1]));
  }
  const one = pathname.match(/^\/api\/cms\/courses\/(-?\d+)$/);
  if (one && method === "GET") return getCourse(request, env, Number(one[1]));
  if (one && method === "PUT") return updateCourse(request, env, Number(one[1]));
  if (one && method === "DELETE") return deleteCourse(request, env, Number(one[1]));

  if (pathname === "/api/host/progress" && (method === "GET" || method === "PUT")) {
    return hostProgress(request, env, url, method);
  }
  if (method === "GET" && pathname === "/api/scores") {
    return listScores(request, env, url);
  }
  if (method === "GET" && pathname === "/api/cms/community/courses") {
    return listCommunity(request, env, url);
  }
  return null;
}

async function listCourses(request, env, url) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const classId = numberOrUndefined(url.searchParams.get("classId"));
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const courses = (store.courses || [])
    .filter((course) => sameId(course.teacherId, auth.teacherId))
    .filter((course) => courseMatchesClass(course, classId))
    .map((course) => {
      const { sections, exercises: _exercises, ...rest } = course;
      return {
        ...rest,
        classIds: normalizeClassIds(course.classIds),
        exerciseCount: countExercises(course),
        sectionCount: (sections || []).length,
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return json({ courses });
}

async function getCourse(request, env, courseId) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const course = await findCourse(env, courseId, auth.teacherId);
  if (!course) return json({ message: "Course not found." }, 404);
  return json(courseDetail(course));
}

async function createCourse(request, env) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const payload = await readJson(request);
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const now = new Date().toISOString();
  const course = {
    id: nextCourseId(store),
    teacherId: auth.teacherId,
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
  store.courses.push(course);
  await writeDoc(env, "teacher-courses", store);
  return json({ course }, 201);
}

async function updateCourse(request, env, courseId) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const payload = await readJson(request);
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const course = store.courses.find((item) => item.id === courseId && sameId(item.teacherId, auth.teacherId));
  if (!course) return json({ message: "Course not found." }, 404);
  if (payload.name != null) course.name = clip(payload.name, 120);
  if (payload.description != null) course.description = clip(payload.description, 500);
  if (payload.banner != null) course.banner = clip(payload.banner, 500);
  if (payload.langCode != null) course.langCode = clip(payload.langCode, 8);
  if (payload.classIds != null) course.classIds = normalizeClassIds(payload.classIds);
  if (payload.level != null) course.level = clip(payload.level, 40);
  if (payload.estimatedMinutes !== undefined) {
    const mins = Number(payload.estimatedMinutes);
    course.estimatedMinutes = Number.isFinite(mins) && mins > 0 ? mins : null;
  }
  if (payload.objectives != null) {
    course.objectives = Array.isArray(payload.objectives)
      ? payload.objectives.map((line) => String(line).trim()).filter(Boolean).slice(0, 8)
      : [];
  }
  if (payload.authorNotes != null) course.authorNotes = clip(payload.authorNotes, 500);
  if (payload.plannedStart != null) course.plannedStart = clip(payload.plannedStart, 32);
  if (payload.plannedEnd != null) course.plannedEnd = clip(payload.plannedEnd, 32);
  course.updatedAt = new Date().toISOString();
  await writeDoc(env, "teacher-courses", store);
  return json({
    course: {
      id: course.id,
      name: course.name,
      description: course.description,
      banner: course.banner,
      langCode: course.langCode,
      classIds: course.classIds || [],
      level: course.level || "",
      estimatedMinutes: course.estimatedMinutes || null,
      objectives: course.objectives || [],
      authorNotes: course.authorNotes || "",
      plannedStart: course.plannedStart || "",
      plannedEnd: course.plannedEnd || "",
      updatedAt: course.updatedAt,
    },
  });
}

async function saveSections(request, env, courseId) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const payload = await readJson(request);
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const course = store.courses.find((item) => item.id === courseId && sameId(item.teacherId, auth.teacherId));
  if (!course) return json({ message: "Course not found." }, 404);
  const incoming = Array.isArray(payload.sections) ? payload.sections : [];
  let nextSection = nextNumericId(incoming.map((section) => section.id), 1);
  let nextExercise = nextNumericId(
    incoming.flatMap((section) => (section.exercises || []).map((exercise) => exercise.id)),
    1
  );
  course.sections = incoming.map((raw, index) => {
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
  course.updatedAt = new Date().toISOString();
  await writeDoc(env, "teacher-courses", store);
  return json({ sections: course.sections, updatedAt: course.updatedAt });
}

async function deleteCourse(request, env, courseId) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const before = store.courses.length;
  store.courses = store.courses.filter((item) => !(item.id === courseId && sameId(item.teacherId, auth.teacherId)));
  if (store.courses.length === before) return json({ message: "Course not found." }, 404);
  await writeDoc(env, "teacher-courses", store);
  return json({ ok: true });
}

async function hostProgress(request, env, url, method) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const source = method === "GET" ? url.searchParams : await readJson(request);
  const classId = Number(method === "GET" ? source.get("classId") : source.classId);
  const courseId = Number(method === "GET" ? source.get("courseId") : source.courseId);
  if (!Number.isFinite(classId) || !Number.isFinite(courseId)) {
    const message = method === "GET" ? "classId and courseId query parameters are required." : "classId and courseId are required.";
    return json({ message }, 400);
  }
  if (method === "GET") {
    return json({ progress: await progressFor(env, auth.teacherId, classId, courseId) });
  }
  const patch = {};
  if (source.completedExerciseIds != null) patch.completedExerciseIds = source.completedExerciseIds;
  if (source.visitedSectionIds != null) patch.visitedSectionIds = source.visitedSectionIds;
  if (source.lastSectionId !== undefined) patch.lastSectionId = source.lastSectionId;
  if (source.lastExerciseId !== undefined) patch.lastExerciseId = source.lastExerciseId;
  const store = await readDoc(env, "host-progress", { records: [] });
  let record = store.records.find((entry) => sameId(entry.teacherId, auth.teacherId) && entry.classId === classId && entry.courseId === courseId);
  if (!record) {
    record = emptyProgress(auth.teacherId, classId, courseId);
    store.records.push(record);
  }
  if (patch.completedExerciseIds != null) record.completedExerciseIds = normalizeIds(patch.completedExerciseIds);
  if (patch.visitedSectionIds != null) record.visitedSectionIds = normalizeIds(patch.visitedSectionIds);
  if (patch.lastSectionId !== undefined) record.lastSectionId = patch.lastSectionId ?? null;
  if (patch.lastExerciseId !== undefined) record.lastExerciseId = patch.lastExerciseId ?? null;
  record.updatedAt = new Date().toISOString();
  await writeDoc(env, "host-progress", store);
  return json({ progress: presentProgress(record, auth.teacherId, classId, courseId) });
}

async function listScores(request, env, url) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const classId = Number(url.searchParams.get("classId"));
  if (!Number.isFinite(classId)) return json({ message: "classId query parameter is required." }, 400);
  const courseId = numberOrUndefined(url.searchParams.get("courseId"));
  const exerciseId = numberOrUndefined(url.searchParams.get("exerciseId"));
  const roomId = url.searchParams.get("roomId")?.trim() || undefined;
  const legacy = await readDoc(env, "student-scores", { students: {}, records: [] });
  const classRecords = mergeScoreRecords(
    (legacy.records || []).filter((record) => sameId(record.teacherId, auth.teacherId) && record.classId === classId),
    await readScoreRecords(env.DB, auth.teacherId, classId)
  );
  const store = { records: classRecords };
  const scores = classRecords
    .filter((record) => courseId == null || record.courseId === courseId)
    .filter((record) => exerciseId == null || record.exerciseId === exerciseId)
    .filter((record) => !roomId || record.roomId === roomId)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  const prefix = `${Number(auth.teacherId)}:${classId}:`;
  const profiles = Object.fromEntries(Object.entries(legacy.students || {}).filter(([key]) => key.startsWith(prefix)));
  for (const record of classRecords) {
    const key = `${prefix}${record.studentUserId}`;
    if (profiles[key]) continue;
    profiles[key] = {
      teacherId: record.teacherId,
      classId,
      studentUserId: String(record.studentUserId),
      displayName: record.displayName || "",
    };
  }
  const students = Object.entries(profiles)
    .map(([key, student]) => enrichStudent(store, student, key))
    .sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));
  const semesterTotals = [...students].sort((a, b) => b.totalScore - a.totalScore || String(a.displayName).localeCompare(String(b.displayName)));
  return json({ classId, teacherId: auth.teacherId, semesterTotals, students, scores });
}

// Scores from the student-scores document (written by Node) and from the
// score_records table (written by rooms). A record key appears once.
function mergeScoreRecords(legacy, rows) {
  const seen = new Set();
  const merged = [];
  for (const record of [...legacy, ...rows]) {
    const key = record?.recordKey;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(record);
  }
  return merged;
}

async function listCommunity(request, env, url) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const store = await readDoc(env, "community-courses", { listings: [] });
  const coursesStore = await readDoc(env, "teacher-courses", { courses: [] });
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const lang = String(url.searchParams.get("langCode") || "").trim().toLowerCase();
  const sort = url.searchParams.get("sort") || "featured";
  let listings = (store.listings || []).filter((item) => item?.status === "public" && (item.reports || []).length < 3);
  if (lang && lang !== "all") listings = listings.filter((item) => String(item.langCode || "en").toLowerCase() === lang);
  if (query) {
    listings = listings.filter((item) => `${item.name || ""} ${item.description || ""} ${item.authorName || ""}`.toLowerCase().includes(query));
  }
  listings.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  if (sort !== "newest" && sort !== "popular") {
    listings.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
  }
  const owned = new Set(
    (coursesStore.courses || [])
      .filter((course) => sameId(course.teacherId, auth.teacherId))
      .map((course) => Number(course.sourceCommunityId))
      .filter((id) => Number.isFinite(id))
  );
  return json({
    courses: listings.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || "",
      banner: item.banner || "",
      langCode: item.langCode || "en",
      authorName: item.authorName || "Teacher",
      publishedByTeacherId: item.publishedByTeacherId,
      publishedAt: item.publishedAt,
      updatedAt: item.updatedAt,
      featured: Boolean(item.featured),
      copyCount: item.copyCount || 0,
      reportCount: (item.reports || []).length,
      sectionCount: (item.sections || []).length,
      exerciseCount: item.exerciseCount || 0,
      isOwner: sameId(item.publishedByTeacherId, auth.teacherId),
      alreadyCopied: owned.has(Number(item.id)),
    })),
    languages: [...new Set(listings.map((item) => String(item.langCode || "en").toLowerCase()))].sort(),
  });
}

async function requireTeacher(request, env) {
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

async function readDoc(env, name, fallback) {
  const row = await env.DB.prepare("SELECT body FROM documents WHERE name = ?").bind(name).first();
  if (!row?.body) return structuredClone(fallback);
  try {
    return JSON.parse(row.body);
  } catch {
    return structuredClone(fallback);
  }
}

async function writeDoc(env, name, value) {
  await env.DB.prepare(
    "INSERT INTO documents (name, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at"
  )
    .bind(name, JSON.stringify(value), new Date().toISOString())
    .run();
}

async function findCourse(env, courseId, teacherId) {
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const course = store.courses.find((item) => item.id === courseId && sameId(item.teacherId, teacherId));
  return course || null;
}

function courseDetail(course) {
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

async function progressFor(env, teacherId, classId, courseId) {
  const store = await readDoc(env, "host-progress", { records: [] });
  const record = store.records.find((entry) => sameId(entry.teacherId, teacherId) && entry.classId === classId && entry.courseId === courseId);
  return presentProgress(record, teacherId, classId, courseId);
}

function emptyProgress(teacherId, classId, courseId) {
  return {
    teacherId: Number(teacherId),
    classId,
    courseId,
    completedExerciseIds: [],
    visitedSectionIds: [],
    lastSectionId: null,
    lastExerciseId: null,
    updatedAt: new Date().toISOString(),
  };
}

function presentProgress(record, teacherId, classId, courseId) {
  return {
    ...emptyProgress(teacherId, classId, courseId),
    ...(record || {}),
    completedExerciseIds: normalizeIds(record?.completedExerciseIds),
    visitedSectionIds: normalizeIds(record?.visitedSectionIds),
    lastSectionId: record?.lastSectionId ?? null,
    lastExerciseId: record?.lastExerciseId ?? null,
  };
}

function enrichStudent(store, student, key) {
  const [teacherId, classId, studentUserId] = key.split(":");
  let totalScore = 0;
  let exerciseCount = 0;
  let firstScoreAt = null;
  let lastScoreAt = null;
  for (const record of store.records || []) {
    if (!sameId(record.teacherId, teacherId) || record.classId !== Number(classId) || String(record.studentUserId) !== studentUserId) continue;
    totalScore += Math.max(0, Number(record.score) || 0);
    exerciseCount += 1;
    if (!firstScoreAt || record.savedAt < firstScoreAt) firstScoreAt = record.savedAt;
    if (!lastScoreAt || record.savedAt > lastScoreAt) lastScoreAt = record.savedAt;
  }
  return { ...student, totalScore, exerciseCount, firstScoreAt, lastScoreAt };
}

function nextCourseId(store) {
  const ids = (store.courses || []).map((course) => course.id).filter((id) => typeof id === "number");
  const minId = ids.length ? Math.min(...ids) : 0;
  return minId <= 0 ? minId - 1 : -1;
}

function nextNumericId(ids, start) {
  const numbers = ids.filter((id) => typeof id === "number");
  return numbers.length ? Math.max(...numbers) + 1 : start;
}

function countExercises(course) {
  return (course.sections || []).reduce((sum, section) => sum + (section.exercises || []).length, 0);
}

function courseMatchesClass(course, classId) {
  if (classId == null) return true;
  const ids = normalizeClassIds(course.classIds);
  return ids.length === 0 || ids.some((id) => String(id) === String(classId));
}

function normalizeClassIds(value) {
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

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
}

function sameId(left, right) {
  return String(left) === String(right);
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function numberOrUndefined(value) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}

function json(data, status = 200) {
  return Response.json(data, { status });
}
