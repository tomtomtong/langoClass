const fs = require("fs");
const paths = require("./paths");

const DATA_FILE = paths.teacherCoursesFile;

function ensureDataFile() {
  paths.ensurePersistentDirs();
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ courses: [] }, null, 2), "utf8");
  }
}

function readStore() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return { courses: Array.isArray(parsed.courses) ? parsed.courses : [] };
  } catch {
    return { courses: [] };
  }
}

function writeStore(store) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function nextCourseId(store) {
  const ids = store.courses.map((c) => c.id).filter((id) => typeof id === "number");
  const minId = ids.length ? Math.min(...ids) : 0;
  return minId <= 0 ? minId - 1 : -1;
}

function nextSectionId(sections) {
  const ids = (sections || []).map((s) => s.id).filter((id) => typeof id === "number");
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function nextExerciseId(sections) {
  const ids = flattenExercises({ sections }).map((e) => e.id).filter((id) => typeof id === "number");
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function flattenExercises(course) {
  const sections = course?.sections || [];
  const exercises = [];
  for (const section of sections) {
    for (const exercise of section.exercises || []) {
      exercises.push(exercise);
    }
  }
  return exercises;
}

function migrateLegacyExercises(course) {
  if (Array.isArray(course.sections)) {
    delete course.exercises;
    return course;
  }

  const legacy = Array.isArray(course.exercises) ? course.exercises : [];
  if (!legacy.length) {
    course.sections = [];
    delete course.exercises;
    return course;
  }

  const ordered = [...legacy].sort((a, b) => (a.order || 0) - (b.order || 0));
  const sectionOrder = [];
  const sectionMap = new Map();

  for (const ex of ordered) {
    const title = String(ex.section || "Exercises").trim().slice(0, 120) || "Exercises";
    if (!sectionMap.has(title)) {
      sectionMap.set(title, {
        id: sectionOrder.length + 1,
        title,
        order: sectionOrder.length + 1,
        exercises: [],
      });
      sectionOrder.push(title);
    }
    const { section: _section, order: _order, ...rest } = ex;
    sectionMap.get(title).exercises.push(rest);
  }

  course.sections = sectionOrder.map((title) => sectionMap.get(title));
  delete course.exercises;
  return course;
}

function normalizeCourse(course) {
  if (!course) return course;
  migrateLegacyExercises(course);
  const sortedSections = [...(course.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  course.sections = sortedSections.map((section, i) => normalizeSection(section, i + 1));
  return course;
}

function normalizeClassIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
}

function courseMatchesClass(course, classId) {
  if (classId == null || classId === "") return true;
  const ids = normalizeClassIds(course.classIds);
  return ids.length === 0 || ids.includes(Number(classId));
}

function listCoursesForTeacher(teacherId, { classId } = {}) {
  const store = readStore();
  return store.courses
    .filter((c) => c.teacherId === teacherId)
    .map((course) => normalizeCourse({ ...course }))
    .filter((c) => courseMatchesClass(c, classId))
    .map(({ sections, exercises: _exercises, ...course }) => ({
      ...course,
      classIds: normalizeClassIds(course.classIds),
      exerciseCount: flattenExercises({ sections }).length,
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getCourseForTeacher(courseId, teacherId) {
  const store = readStore();
  const course = store.courses.find((c) => c.id === courseId && c.teacherId === teacherId);
  return course ? normalizeCourse({ ...course }) : null;
}

function getCourseById(courseId) {
  const store = readStore();
  const course = store.courses.find((c) => c.id === courseId);
  return course ? normalizeCourse({ ...course }) : null;
}

function createCourse(teacherId, payload) {
  const store = readStore();
  const now = new Date().toISOString();
  const course = {
    id: nextCourseId(store),
    teacherId,
    name: String(payload.name || "Untitled course").trim().slice(0, 120),
    description: String(payload.description || "").trim().slice(0, 500),
    banner: String(payload.banner || "").trim().slice(0, 500),
    langCode: String(payload.langCode || "en").trim().slice(0, 8),
    classIds: normalizeClassIds(payload.classIds),
    sections: [
      {
        id: 1,
        title: "Section 1",
        order: 1,
        exercises: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  store.courses.push(course);
  writeStore(store);
  return course;
}

function updateCourse(courseId, teacherId, payload) {
  const store = readStore();
  const idx = store.courses.findIndex((c) => c.id === courseId && c.teacherId === teacherId);
  if (idx < 0) return null;

  const course = store.courses[idx];
  normalizeCourse(course);
  if (payload.name != null) course.name = String(payload.name).trim().slice(0, 120);
  if (payload.description != null) course.description = String(payload.description).trim().slice(0, 500);
  if (payload.banner != null) course.banner = String(payload.banner).trim().slice(0, 500);
  if (payload.langCode != null) course.langCode = String(payload.langCode).trim().slice(0, 8);
  if (payload.classIds != null) course.classIds = normalizeClassIds(payload.classIds);
  course.updatedAt = new Date().toISOString();
  delete course.exercises;
  store.courses[idx] = course;
  writeStore(store);
  return normalizeCourse({ ...course });
}

function deleteCourse(courseId, teacherId) {
  const store = readStore();
  const idx = store.courses.findIndex((c) => c.id === courseId && c.teacherId === teacherId);
  if (idx < 0) return false;
  store.courses.splice(idx, 1);
  writeStore(store);
  return true;
}

function removeAllCoursesForTeacher(teacherId) {
  const store = readStore();
  const removed = store.courses.filter((c) => c.teacherId === teacherId);
  store.courses = store.courses.filter((c) => c.teacherId !== teacherId);
  writeStore(store);
  return removed.map((course) => normalizeCourse({ ...course }));
}

function normalizeBuzzinQuestionText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.text || value.question || value.title || "").trim();
  }
  return String(value).trim();
}

function normalizeBuzzinBuddyField(buddy) {
  if (buddy == null || buddy === "") return null;
  if (typeof buddy === "string") return buddy.trim().slice(0, 200) || null;
  if (typeof buddy === "object") {
    return (
      String(buddy.description || buddy.importNumber || buddy.name || "")
        .trim()
        .slice(0, 200) || null
    );
  }
  return null;
}

function collectBuzzinQuestionsFromRaw(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const first = items[0] || {};

  const fromFirstItem = (first.questions || [])
    .map(normalizeBuzzinQuestionText)
    .filter(Boolean);
  if (fromFirstItem.length) return fromFirstItem;

  const fromExtraItems = items
    .slice(1)
    .map((item) => normalizeBuzzinQuestionText(item?.question || item?.text || item?.title))
    .filter(Boolean);
  if (fromExtraItems.length) return fromExtraItems;

  const topLevel = (raw?.questions || []).map(normalizeBuzzinQuestionText).filter(Boolean);
  if (topLevel.length) return topLevel;

  return [];
}

function ensureSingleCorrectOption(options) {
  if (!Array.isArray(options) || !options.length) return [];
  const firstCorrectIdx = options.findIndex((o) => o.isCorrect);
  const correctIdx = firstCorrectIdx >= 0 ? firstCorrectIdx : 0;
  return options.map((o, i) => ({ ...o, isCorrect: i === correctIdx }));
}

function normalizeExercise(raw, order) {
  const type = String(raw.type || "mcquiz").toLowerCase();
  const base = {
    id: raw.id,
    title: String(raw.title || "Untitled exercise").trim().slice(0, 200),
    subTitle: String(raw.subTitle || "").trim().slice(0, 120),
    order: order ?? raw.order ?? 1,
    type,
    items: [],
  };

  if (type === "video") {
    const item = raw.items?.[0] || {};
    const url = String(item.videoUrl || raw.videoUrl || "").trim().slice(0, 500);
    const captionTracks = [];
    const seen = new Set();
    const pushTrack = (languageRaw, urlRaw) => {
      const trackUrl = String(urlRaw || "").trim().slice(0, 500);
      const language = String(languageRaw || "en")
        .trim()
        .toLowerCase()
        .split(/[-_]/)[0]
        .slice(0, 8);
      if (!trackUrl || !language || seen.has(language)) return;
      seen.add(language);
      captionTracks.push({ language, url: trackUrl });
    };

    (Array.isArray(item.captionTracks) ? item.captionTracks : []).forEach((track) => {
      pushTrack(track?.language || track?.lang, track?.url || track?.captionUrl);
    });

    const legacyCaptionUrl = String(
      item.captionUrl || item.subtitleUrl || raw.captionUrl || ""
    )
      .trim()
      .slice(0, 500);
    if (legacyCaptionUrl) {
      pushTrack(item.captionLanguage || item.captionLang || "en", legacyCaptionUrl);
    }

    const primary =
      captionTracks.find((track) => track.language === String(item.captionLanguage || "").trim()) ||
      captionTracks[0] ||
      null;

    base.subTitle = base.subTitle || "Video";
    base.items = url
      ? [
          {
            videoUrl: url,
            ...(primary ? { captionUrl: primary.url, captionLanguage: primary.language } : {}),
            ...(captionTracks.length ? { captionTracks } : {}),
          },
        ]
      : [];
  } else if (type === "buzzin") {
    const item = raw.items?.[0] || raw;
    const legacyQuestion = collectBuzzinQuestionsFromRaw(raw)[0] || "";
    const topic = String(item.topic || legacyQuestion || item.title || raw.title || "")
      .trim()
      .slice(0, 500);
    const sttLanguage = String(item.sttLanguage || raw.sttLanguage || "")
      .trim()
      .toLowerCase()
      .split("-")[0]
      .slice(0, 8);
    base.subTitle = base.subTitle || "Buzz In";
    base.items = topic
      ? [{ topic, ...(sttLanguage ? { sttLanguage } : {}) }]
      : [];
  } else {
    const isFastMc = type === "fastmcquiz";
    base.type = isFastMc ? "fastmcquiz" : "mcquiz";
    base.subTitle = base.subTitle || (isFastMc ? "Fast MC Quiz" : "MC Quiz");
    base.items = (raw.items || [])
      .map((item, idx) => {
        const options = ensureSingleCorrectOption(
          (item.options || [])
            .slice(0, 6)
            .map((o) => ({
              text: String(o.text || "").trim().slice(0, 200),
              isCorrect: !!o.isCorrect,
            }))
            .filter((o) => o.text)
        );
        const image = String(item.image || item.imageUrl || "").trim().slice(0, 500);
        return {
          title: String(item.title || item.question || `Question ${idx + 1}`).trim().slice(0, 500),
          options,
          timeLimit: Math.min(60, Math.max(5, Number(item.timeLimit) || 15)),
          image: image || null,
        };
      })
      .filter((item) => item.title && item.options.length >= 2)
      .slice(0, 30);
  }

  return base;
}

function normalizeSection(raw, order) {
  const sortedExercises = [...(raw.exercises || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const exercises = sortedExercises.map((exercise, i) => normalizeExercise(exercise, i + 1));
  return {
    id: raw.id,
    title: String(raw.title || `Section ${order}`).trim().slice(0, 120),
    banner: String(raw.banner || "").trim().slice(0, 500),
    order: order ?? raw.order ?? 1,
    exercises,
  };
}

function updateSectionBanner(courseId, teacherId, sectionId, bannerUrl) {
  const store = readStore();
  const idx = store.courses.findIndex((c) => c.id === courseId && c.teacherId === teacherId);
  if (idx < 0) return null;

  const course = store.courses[idx];
  normalizeCourse(course);
  const sectionIdx = course.sections.findIndex((s) => s.id === sectionId);
  if (sectionIdx < 0) return null;

  const oldBanner = course.sections[sectionIdx].banner || "";
  course.sections[sectionIdx].banner = String(bannerUrl || "").trim().slice(0, 500);
  course.updatedAt = new Date().toISOString();
  store.courses[idx] = course;
  writeStore(store);

  return {
    section: { ...course.sections[sectionIdx] },
    oldBanner,
    updatedAt: course.updatedAt,
  };
}

function saveSections(courseId, teacherId, sectionsPayload) {
  const store = readStore();
  const idx = store.courses.findIndex((c) => c.id === courseId && c.teacherId === teacherId);
  if (idx < 0) return null;

  const course = store.courses[idx];
  normalizeCourse(course);

  let nextSection = nextSectionId([]);
  let nextExercise = nextExerciseId(course.sections || []);

  const sections = (sectionsPayload || []).map((rawSection, sectionIndex) => {
    const section = normalizeSection(rawSection, sectionIndex + 1);

    if (typeof rawSection.id === "number") {
      section.id = rawSection.id;
      nextSection = Math.max(nextSection, rawSection.id + 1);
    } else {
      section.id = nextSection;
      nextSection += 1;
    }
    section.order = sectionIndex + 1;

    section.exercises = (rawSection.exercises || []).map((rawExercise, exerciseIndex) => {
      const exercise = normalizeExercise(rawExercise, exerciseIndex + 1);
      if (typeof rawExercise.id === "number") {
        exercise.id = rawExercise.id;
        nextExercise = Math.max(nextExercise, rawExercise.id + 1);
      } else {
        exercise.id = nextExercise;
        nextExercise += 1;
      }
      exercise.order = exerciseIndex + 1;
      return exercise;
    });

    return section;
  });

  course.sections = sections;
  delete course.exercises;
  course.updatedAt = new Date().toISOString();
  store.courses[idx] = course;
  writeStore(store);
  return normalizeCourse({ ...course });
}

function courseDetailResponse(course) {
  if (!course) return null;
  const normalized = normalizeCourse({ ...course });
  return {
    success: true,
    course: {
      id: normalized.id,
      name: normalized.name,
      banner: normalized.banner || null,
      langCode: normalized.langCode || "en",
      description: normalized.description || "",
      classIds: normalizeClassIds(normalized.classIds),
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
    },
    sections: (normalized.sections || []).map((section) => ({
      ...section,
      exercises: (section.exercises || []).map((exercise) => ({ ...exercise })),
    })),
  };
}

module.exports = {
  listCoursesForTeacher,
  getCourseForTeacher,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  removeAllCoursesForTeacher,
  saveSections,
  updateSectionBanner,
  courseDetailResponse,
  flattenExercises,
};
