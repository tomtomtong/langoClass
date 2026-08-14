const { normalizeImportedExercises } = require("./exercise-generator");

const IMPORT_VERSION = 1;

function normalizeSectionEntry(raw, index = 0) {
  const exercises = normalizeImportedExercises(raw?.exercises);
  if (!exercises.length) return null;

  return {
    sectionId:
      raw?.sectionId != null && Number.isFinite(Number(raw.sectionId))
        ? Number(raw.sectionId)
        : null,
    sectionTitle: String(raw.sectionTitle || raw.title || `Section ${index + 1}`).trim(),
    sectionIndex:
      raw?.sectionIndex != null && Number.isFinite(Number(raw.sectionIndex))
        ? Number(raw.sectionIndex)
        : null,
    exercises,
  };
}

function parseImportPayload(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Import file must be a JSON object.");
  }

  if (Array.isArray(data.sections)) {
    const sections = data.sections
      .map((section, index) => normalizeSectionEntry(section, index))
      .filter(Boolean);
    if (!sections.length) {
      throw new Error("Import file has no valid exercises in any section.");
    }
    return {
      version: Number(data.version) || IMPORT_VERSION,
      mode: "batch",
      courseId: data.courseId ?? null,
      courseName: String(data.courseName || "").trim(),
      sections,
      exerciseCount: sections.reduce((sum, section) => sum + section.exercises.length, 0),
    };
  }

  if (Array.isArray(data.exercises)) {
    const exercises = normalizeImportedExercises(data.exercises);
    if (!exercises.length) {
      throw new Error("Import file has no valid exercises.");
    }
    return {
      version: Number(data.version) || IMPORT_VERSION,
      mode: "section",
      courseId: data.courseId ?? null,
      courseName: String(data.courseName || "").trim(),
      sectionId:
        data.sectionId != null && Number.isFinite(Number(data.sectionId))
          ? Number(data.sectionId)
          : null,
      sectionTitle: String(data.sectionTitle || data.title || "Imported section").trim(),
      sectionIndex:
        data.sectionIndex != null && Number.isFinite(Number(data.sectionIndex))
          ? Number(data.sectionIndex)
          : null,
      sections: [
        {
          sectionId:
            data.sectionId != null && Number.isFinite(Number(data.sectionId))
              ? Number(data.sectionId)
              : null,
          sectionTitle: String(data.sectionTitle || data.title || "Imported section").trim(),
          sectionIndex:
            data.sectionIndex != null && Number.isFinite(Number(data.sectionIndex))
              ? Number(data.sectionIndex)
              : null,
          exercises,
        },
      ],
      exerciseCount: exercises.length,
    };
  }

  throw new Error('Import JSON must include either an "exercises" array or a "sections" array.');
}

function buildExportPayload({
  course,
  section,
  sectionIndex,
  exercises,
  mode = "section",
  sections = [],
}) {
  const exportedAt = new Date().toISOString();
  const base = {
    version: IMPORT_VERSION,
    exportedAt,
    courseId: course?.id ?? null,
    courseName: String(course?.name || "").trim(),
  };

  if (mode === "batch") {
    return {
      ...base,
      mode: "batch",
      sections: sections.map((entry, index) => ({
        sectionId: entry.sectionId ?? null,
        sectionTitle: entry.sectionTitle || `Section ${index + 1}`,
        sectionIndex: entry.sectionIndex ?? index,
        exercises: normalizeImportedExercises(entry.exercises),
      })),
    };
  }

  return {
    ...base,
    mode: "section",
    sectionId: section?.id ?? null,
    sectionTitle: section?.title || `Section ${Number(sectionIndex) + 1}`,
    sectionIndex: sectionIndex ?? null,
    exercises: normalizeImportedExercises(exercises),
  };
}

module.exports = {
  IMPORT_VERSION,
  parseImportPayload,
  buildExportPayload,
};
