import { developerAuth, developerClassList, developerLogin } from "./dev-account.js";
import { handleCommunityApi } from "./community.js";
import { deleteUpload } from "./course-files.js";
import { handleCourseMediaApi } from "./course-media.js";
import { handleCourseTransferApi } from "./course-transfer.js";
import { cmsAppContext } from "./cms-context.js";
import { handleLangoApi } from "./lango-api.js";
import { handleQuestionTtsApi } from "./question-tts.js";
import { handleCmsAiApi } from "./cms-ai.js";
import { handleCaptionsApi } from "./captions.js";
import { readScoreRecords } from "./score-store.js";
import {
  classIdOf,
  clip,
  countExercises,
  courseDetail,
  json,
  newCourse,
  normalizeClassIds,
  numberSections,
  readDoc,
  readJson,
  requireTeacher,
  sameId,
  writeDoc,
} from "./d1-store.js";

export async function handleStoreApi(request, env, url) {
  if (!env.DB) return null;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "POST" && pathname === "/api/lango/login") {
    const dev = await developerLogin(request);
    if (dev) return dev;
  }
  if (method === "GET" && pathname === "/api/lango/classList") {
    const dev = await developerClassList(request);
    if (dev) return dev;
  }
  const lango = await handleLangoApi(request, env, url);
  if (lango) return lango;
  if (method === "GET" && pathname === "/api/cms/app-context") {
    return json(cmsAppContext(env));
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
  if (method === "GET" && pathname === "/api/cms/dashboard/progress") {
    return dashboardProgress(request, env, url);
  }
  return (await handleQuestionTtsApi(request, env, url)) || (await handleCmsAiApi(request, env, url)) || (await handleCaptionsApi(request, env, url)) || (await handleCommunityApi(request, env, url)) || (await handleCourseMediaApi(request, env, url)) || (await handleCourseTransferApi(request, env, url));
}

async function listCourses(request, env, url) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const classId = classIdOf(url.searchParams.get("classId")) ?? undefined;
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
  const course = newCourse(store, auth.teacherId, payload);
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
  const oldBanner = course.banner || "";
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
  if (oldBanner && oldBanner !== course.banner) await deleteUpload(env, oldBanner);
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
  const oldBanners = (course.sections || []).map((section) => section.banner).filter(Boolean);
  course.sections = numberSections(payload.sections);
  course.updatedAt = new Date().toISOString();
  await writeDoc(env, "teacher-courses", store);
  // Banners a section no longer uses, as server.js removed them from disk.
  const kept = new Set(course.sections.map((section) => String(section.banner || "").trim()));
  for (const banner of oldBanners) if (!kept.has(banner)) await deleteUpload(env, banner);
  return json({ sections: course.sections, updatedAt: course.updatedAt });
}

async function deleteCourse(request, env, courseId) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const course = store.courses.find((item) => item.id === courseId && sameId(item.teacherId, auth.teacherId));
  if (!course) return json({ message: "Course not found." }, 404);
  store.courses = store.courses.filter((item) => item !== course);
  await writeDoc(env, "teacher-courses", store);
  await deleteUpload(env, course.banner);
  for (const section of course.sections || []) {
    await deleteUpload(env, section.banner);
    await deleteUpload(env, section.introVideoUrl);
  }
  return json({ ok: true });
}

async function hostProgress(request, env, url, method) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const source = method === "GET" ? url.searchParams : await readJson(request);
  const classId = classIdOf(method === "GET" ? source.get("classId") : source.classId);
  const courseId = Number(method === "GET" ? source.get("courseId") : source.courseId);
  if (classId == null || !Number.isFinite(courseId)) {
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
  let record = store.records.find((entry) => sameId(entry.teacherId, auth.teacherId) && sameId(entry.classId, classId) && entry.courseId === courseId);
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
  const classId = classIdOf(url.searchParams.get("classId"));
  if (classId == null) return json({ message: "classId query parameter is required." }, 400);
  const courseId = numberOrUndefined(url.searchParams.get("courseId"));
  const exerciseId = numberOrUndefined(url.searchParams.get("exerciseId"));
  const roomId = url.searchParams.get("roomId")?.trim() || undefined;
  const { classRecords, students } = await classScores(env, auth.teacherId, classId);
  const scores = classRecords
    .filter((record) => courseId == null || record.courseId === courseId)
    .filter((record) => exerciseId == null || record.exerciseId === exerciseId)
    .filter((record) => !roomId || record.roomId === roomId)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  const semesterTotals = semesterOrder(students);
  return json({ classId, teacherId: auth.teacherId, semesterTotals, students, scores });
}

// Each course a class can see with how far the class got, as server.js
// /api/cms/dashboard/progress builds it. Started courses sort first.
async function dashboardProgress(request, env, url) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const classId = classIdOf(url.searchParams.get("classId"));
  if (classId == null || (typeof classId === "number" && classId <= 0)) return json({ message: "classId query parameter is required." }, 400);

  const [store, progressStore, { classRecords }] = await Promise.all([
    readDoc(env, "teacher-courses", { courses: [] }),
    readDoc(env, "host-progress", { records: [] }),
    classScores(env, auth.teacherId, classId),
  ]);
  const progressByCourse = new Map(
    (progressStore.records || [])
      .filter((record) => sameId(record.teacherId, auth.teacherId) && sameId(record.classId, classId))
      .map((record) => [Number(record.courseId), record])
  );
  const courses = (store.courses || [])
    .filter((course) => sameId(course.teacherId, auth.teacherId) && courseMatchesClass(course, classId))
    .map((course) => {
      const progress = presentProgress(progressByCourse.get(Number(course.id)), auth.teacherId, classId, course.id);
      const scores = classRecords.filter((record) => record.courseId === course.id);
      return courseProgress(course, progress, scores);
    })
    .sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (a.started !== b.started) return a.started ? -1 : 1;
      if (aTime !== bTime) return bTime - aTime;
      return String(a.name).localeCompare(String(b.name));
    });
  return json({ classId, courses });
}

function courseProgress(course, progress, scores) {
  const sections = [...(course.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const exercises = sections.flatMap((section) =>
    [...(section.exercises || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
  );
  const completed = new Set(progress.completedExerciseIds.map(Number));
  const completedCount = exercises.filter((exercise) => completed.has(Number(exercise.id))).length;
  const totalExercises = exercises.length;
  const percent = totalExercises ? Math.round((completedCount / totalExercises) * 100) : 0;
  const lastSection = sections.find((section) => section.id === progress.lastSectionId);
  const lastExercise = exercises.find((exercise) => exercise.id === progress.lastExerciseId);
  const started =
    completedCount > 0 ||
    progress.lastSectionId != null ||
    progress.lastExerciseId != null ||
    progress.visitedSectionIds.length > 0;
  const { engagementScore, topStruggle } = engagementInsights(scores);
  const complete = totalExercises > 0 && completedCount >= totalExercises;
  return {
    courseId: course.id,
    name: course.name,
    banner: course.banner || null,
    description: course.description || "",
    totalExercises,
    completedCount,
    percent,
    lastSectionId: progress.lastSectionId ?? null,
    lastSectionTitle: lastSection?.title || null,
    lastExerciseTitle: lastExercise?.title || null,
    updatedAt: progress.updatedAt || null,
    started,
    status: complete ? "completed" : started ? "in_progress" : "not_started",
    engagementScore: engagementScore ?? (started ? percent : null),
    topStruggle: topStruggle || lastExercise?.title || null,
  };
}

// The dashboard has no class size, so engagement is the average score and the
// struggle is the exercise with the lowest average.
function engagementInsights(scores) {
  if (!scores.length) return { engagementScore: null, topStruggle: null };
  const byExercise = new Map();
  for (const record of scores) {
    const key = Number(record.exerciseId);
    if (!byExercise.has(key)) byExercise.set(key, { title: record.exerciseTitle, scores: [] });
    byExercise.get(key).scores.push(Math.max(0, Number(record.score) || 0));
  }
  let topStruggle = null;
  let lowest = Infinity;
  for (const entry of byExercise.values()) {
    const average = entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length;
    if (average < lowest) {
      lowest = average;
      topStruggle = entry.title || null;
    }
  }
  const total = scores.reduce((sum, record) => sum + Math.max(0, Number(record.score) || 0), 0);
  return { engagementScore: Math.min(100, Math.round(total / scores.length)), topStruggle };
}

// A class's score records from both stores and each student's running total.
async function classScores(env, teacherId, classId) {
  const legacy = await readDoc(env, "student-scores", { students: {}, records: [] });
  const classRecords = mergeScoreRecords(
    (legacy.records || []).filter((record) => sameId(record.teacherId, teacherId) && sameId(record.classId, classId)),
    await readScoreRecords(env.DB, teacherId, classId)
  );
  const store = { records: classRecords };
  const prefix = `${teacherId}:${classId}:`;
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
  return { classRecords, students };
}

// The semester leaderboard a room shows when an exercise ends, in the shape
// server.js getSemesterLeaderboardForRoom sends.
export async function semesterLeaderboard(env, teacherId, classId) {
  const id = classIdOf(classId);
  if (!env?.DB || teacherId == null || teacherId === "" || id == null) return [];
  const { students } = await classScores(env, teacherId, id);
  return semesterOrder(students).map((student) => ({
    id: student.studentUserId,
    name: student.displayName,
    score: student.totalScore,
  }));
}

function semesterOrder(students) {
  return [...students].sort((a, b) => b.totalScore - a.totalScore || String(a.displayName).localeCompare(String(b.displayName)));
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

async function findCourse(env, courseId, teacherId) {
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const course = store.courses.find((item) => item.id === courseId && sameId(item.teacherId, teacherId));
  return course || null;
}

async function progressFor(env, teacherId, classId, courseId) {
  const store = await readDoc(env, "host-progress", { records: [] });
  const record = store.records.find((entry) => sameId(entry.teacherId, teacherId) && sameId(entry.classId, classId) && entry.courseId === courseId);
  return presentProgress(record, teacherId, classId, courseId);
}

function emptyProgress(teacherId, classId, courseId) {
  return {
    teacherId: Number.isFinite(Number(teacherId)) ? Number(teacherId) : String(teacherId),
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
    if (!sameId(record.teacherId, teacherId) || !sameId(record.classId, classId) || String(record.studentUserId) !== studentUserId) continue;
    totalScore += Math.max(0, Number(record.score) || 0);
    exerciseCount += 1;
    if (!firstScoreAt || record.savedAt < firstScoreAt) firstScoreAt = record.savedAt;
    if (!lastScoreAt || record.savedAt > lastScoreAt) lastScoreAt = record.savedAt;
  }
  return { ...student, totalScore, exerciseCount, firstScoreAt, lastScoreAt };
}

function courseMatchesClass(course, classId) {
  if (classId == null) return true;
  const ids = normalizeClassIds(course.classIds);
  return ids.length === 0 || ids.some((id) => String(id) === String(classId));
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
}

function numberOrUndefined(value) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

