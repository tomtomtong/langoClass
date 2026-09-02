function normalizeExerciseType(type) {
  return String(type || "")
    .toLowerCase()
    .replace(/[_\s-]/g, "");
}

function isMcQuizExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "mcquiz";
}

function isFastMcQuizExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "fastmcquiz";
}

function isLiveMcQuizExercise(exercise) {
  return isMcQuizExercise(exercise) || isFastMcQuizExercise(exercise);
}

function isVideoExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "video";
}

function isBuzzinExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "buzzin";
}

function ensureSingleCorrectOption(options) {
  if (!Array.isArray(options) || !options.length) return [];
  const firstCorrectIdx = options.findIndex((o) => o.isCorrect);
  const correctIdx = firstCorrectIdx >= 0 ? firstCorrectIdx : 0;
  return options.map((o, i) => ({ ...o, isCorrect: i === correctIdx }));
}

function mcQuizPayloadFromExercise(exercise) {
  if (!exercise || !isLiveMcQuizExercise(exercise)) return null;

  const questions = (exercise.items || [])
    .map((item) => {
      const normalizedOptions = ensureSingleCorrectOption(
        (item.options || [])
          .map((o) => ({
            text: String(o.text || "").trim(),
            isCorrect: !!o.isCorrect,
          }))
          .filter((o) => o.text)
      );
      const options = normalizedOptions.map((o) => o.text);
      const correctIndex = normalizedOptions.findIndex((o) => o.isCorrect);
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

  const speakLangCode = String(exercise.speakLangCode || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0]
    .slice(0, 8);

  return {
    title: exercise.title || exercise.subTitle || "Class quiz",
    questions,
    fastMode: isFastMcQuizExercise(exercise),
    ...(speakLangCode ? { speakLangCode } : {}),
  };
}

module.exports = {
  normalizeExerciseType,
  isMcQuizExercise,
  isFastMcQuizExercise,
  isLiveMcQuizExercise,
  isVideoExercise,
  isBuzzinExercise,
  ensureSingleCorrectOption,
  mcQuizPayloadFromExercise,
};
