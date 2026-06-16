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

function mcQuizPayloadFromExercise(exercise) {
  if (!exercise || !isLiveMcQuizExercise(exercise)) return null;

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
    fastMode: isFastMcQuizExercise(exercise),
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

const mediaBlobCache = new Map();

function resolvedMediaUrl(url) {
  const u = String(url || "").trim();
  if (!u) return u;
  return mediaBlobCache.get(u) || u;
}

function collectExerciseMediaUrls(exercises) {
  const urls = new Set();
  if (!Array.isArray(exercises)) return [];

  for (const exercise of exercises) {
    if (isVideoExercise(exercise)) {
      const video = videoUrlFromExercise(exercise);
      if (video) urls.add(String(video).trim());
    }
    if (isLiveMcQuizExercise(exercise)) {
      for (const item of exercise.items || []) {
        const image = String(item.image || item.imageUrl || "").trim();
        if (image) urls.add(image);
      }
    }
  }

  return [...urls];
}

async function preloadMediaUrl(url) {
  const u = String(url || "").trim();
  if (!u || mediaBlobCache.has(u)) return;

  try {
    const res = await fetch(u);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    mediaBlobCache.set(u, URL.createObjectURL(blob));
  } catch {
    const path = u.split("?")[0].toLowerCase();
    const isVideo = /\.(mp4|webm|ogg|mov|m4v)(\b|$)/.test(path);
    if (isVideo) {
      await new Promise((resolve) => {
        const video = document.createElement("video");
        video.preload = "auto";
        video.oncanplaythrough = video.onerror = () => resolve();
        video.src = u;
        video.load();
      });
    } else {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = u;
      });
    }
  }
}

async function preloadExerciseMedia(exercises, { onProgress } = {}) {
  const urls = collectExerciseMediaUrls(exercises);
  let done = 0;
  for (const url of urls) {
    await preloadMediaUrl(url);
    done += 1;
    onProgress?.(done, urls.length);
  }
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
