function normalizeExerciseType(type) {
  return String(type || "")
    .toLowerCase()
    .replace(/[_\s-]/g, "");
}

function isMcQuizExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "mcquiz";
}

function isVideoExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "video";
}

function isBuzzinExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "buzzin";
}

function mcQuizPayloadFromExercise(exercise) {
  if (!exercise || !isMcQuizExercise(exercise)) return null;

  const questions = (exercise.items || [])
    .map((item) => {
      const options = (item.options || []).map((o) => String(o.text || "").trim());
      const correctIndex = (item.options || []).findIndex((o) => o.isCorrect);
      const image = String(item.image || item.imageUrl || "").trim();
      return {
        text: String(item.title || item.question || "").trim(),
        options,
        correctIndex: correctIndex >= 0 ? correctIndex : 0,
        timeLimit: item.timeLimit ?? item.duration_seconds ?? 15,
        image: image || null,
      };
    })
    .filter((q) => q.text && q.options.length >= 2);

  return {
    title: exercise.title || exercise.subTitle || "Class quiz",
    questions,
  };
}

function videoUrlFromExercise(exercise) {
  if (!exercise || !isVideoExercise(exercise)) return null;
  const item = exercise?.items?.[0];
  return item?.videoUrl || item?.video_url || null;
}

function buzzinFromExercise(exercise) {
  if (!exercise || !isBuzzinExercise(exercise)) return null;
  const item = exercise?.items?.[0];
  if (!item) return null;
  return {
    title: item.title || exercise.title || "",
    buddy: item.buddy || null,
    questions: item.questions || [],
  };
}

function exerciseMetaLabel(exercise) {
  const parts = [];
  if (exercise?.subTitle) parts.push(exercise.subTitle);
  else if (exercise?.type) parts.push(exercise.type);
  if (exercise?.order != null) parts.push(`#${exercise.order}`);
  return parts.join(" · ");
}

/** Normalize exercise from CMS or legacy session payload. */
function exerciseFromSessionRecord(record) {
  if (!record) return null;

  if (record.type && (record.items || record.title)) {
    return {
      id: record.id,
      type: record.type,
      title: record.title,
      subTitle: record.subTitle,
      items: record.items || [],
    };
  }

  return {
    id: record.exercise_id,
    type: record.type,
    title: record.title,
    subTitle: record.subTitle,
    items: record.data?.items || [],
  };
}
