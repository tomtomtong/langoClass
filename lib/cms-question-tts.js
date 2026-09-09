function normalizeSpeakLangCode(code) {
  return String(code || "en")
    .trim()
    .toLowerCase() || "en";
}

function speakableTextForItem(exerciseType, item) {
  if (!item) return { text: "", purpose: "question" };
  if (exerciseType === "buzzin") {
    return { text: String(item.topic || "").trim(), purpose: "topic" };
  }
  if (exerciseType === "video") {
    return { text: "", purpose: "question" };
  }
  return { text: String(item.title || "").trim(), purpose: "question" };
}

function collectFlatTtsItemsFromGroupItems(groupItems, defaultSpeakLangCode, questionOffset = 0) {
  const items = [];
  const { flat } = flattenGroupItemsForReview(groupItems);
  flat.forEach((entry, index) => {
    const speakLangCode = normalizeSpeakLangCode(
      entry.meta?.speakLangCode ||
        groupItems.find(({ index: exerciseIndex }) => exerciseIndex === entry.exerciseIndex)?.exercise
          ?.speakLangCode ||
        defaultSpeakLangCode
    );
    const { text, purpose } = speakableTextForItem(entry.type, entry.item);
    if (!text) return;
    items.push({
      key: `flat:${questionOffset + index}`,
      text,
      speakLangCode,
      purpose,
    });
  });
  return items;
}

function flattenGroupItemsForReview(groupItems) {
  const flat = [];
  const videos = [];
  (groupItems || []).forEach(({ exercise, index: exerciseIndex }) => {
    if (!exercise) return;
    if (exercise.type === "video") {
      videos.push({ exercise, exerciseIndex });
      return;
    }
    (exercise.items || []).forEach((item, itemIndex) => {
      flat.push({
        type: exercise.type || "mcquiz",
        item,
        exerciseIndex,
        itemIndex,
        included: exercise.included !== false,
        meta: {
          speakLangCode: exercise.speakLangCode || null,
          title: exercise.title,
          subTitle: exercise.subTitle,
        },
      });
    });
  });
  return { flat, videos };
}

function collectTtsItemsFromExercises(exercises, defaultSpeakLangCode) {
  const items = [];
  (exercises || []).forEach((exercise, exerciseIndex) => {
    const speakLangCode = normalizeSpeakLangCode(exercise.speakLangCode || defaultSpeakLangCode);
    (exercise.items || []).forEach((item, itemIndex) => {
      const { text, purpose } = speakableTextForItem(exercise.type, item);
      if (!text) return;
      items.push({
        key: `${exerciseIndex}:${itemIndex}`,
        text,
        speakLangCode,
        purpose,
      });
    });
  });
  return items;
}

function dedupeTtsItems(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items || []) {
    const signature = `${item.purpose}|${item.speakLangCode}|${item.text}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(item);
  }
  return unique;
}

module.exports = {
  collectFlatTtsItemsFromGroupItems,
  collectTtsItemsFromExercises,
  dedupeTtsItems,
  flattenGroupItemsForReview,
  normalizeSpeakLangCode,
  speakableTextForItem,
};
