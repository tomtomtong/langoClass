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

function normalizeBuzzinQuestionText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.text || value.question || value.title || "").trim();
  }
  return String(value).trim();
}

function normalizeBuzzinBuddy(buddy) {
  if (buddy == null || buddy === "") return null;
  if (typeof buddy === "string") return buddy.trim() || null;
  if (typeof buddy === "object") {
    return (
      String(buddy.description || buddy.importNumber || buddy.name || "").trim() || null
    );
  }
  return null;
}

function buddyDisplayText(buddy) {
  if (!buddy) return "";
  if (typeof buddy === "string") return buddy;
  return buddy.description || buddy.importNumber || buddy.name || "";
}

function collectBuzzinQuestions(exercise) {
  const items = Array.isArray(exercise?.items) ? exercise.items : [];
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

  const topLevel = (exercise?.questions || [])
    .map(normalizeBuzzinQuestionText)
    .filter(Boolean);
  if (topLevel.length) return topLevel;

  return [];
}

function buzzinFromExercise(exercise) {
  if (!exercise || !isBuzzinExercise(exercise)) return null;

  const items = Array.isArray(exercise.items) ? exercise.items : [];
  const first = items[0] || {};
  const topic = String(
    first.topic ||
      first.title ||
      collectBuzzinQuestions(exercise)[0] ||
      exercise.title ||
      ""
  ).trim();

  if (!topic) return null;

  return { topic };
}

function renderBuzzinWinnersList(listEl, winners, emptyText) {
  if (!listEl) return;
  listEl.innerHTML = winners.length
    ? winners
        .map(
          (w) =>
            `<li><span class="buzzin-rank">${w.rank}</span><span>${escapeHtml(w.displayName)}</span></li>`
        )
        .join("")
    : `<li class="hint">${escapeHtml(emptyText || "Waiting for students to buzz in…")}</li>`;
}

function renderBuzzinResponsesList(listEl, responses, currentTurn, emptyText) {
  if (!listEl) return;
  const items = [...(responses || [])];
  if (currentTurn && !items.some((r) => r.playerId === currentTurn.playerId)) {
    items.push({
      playerId: currentTurn.playerId,
      displayName: currentTurn.displayName,
      rank: currentTurn.rank,
      text: "",
      pending: true,
    });
  }

  if (!items.length) {
    listEl.innerHTML = `<li class="hint">${escapeHtml(emptyText || "Waiting for answers…")}</li>`;
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const body = item.pending
        ? `<span class="buzzin-response-pending">Speaking…</span>`
        : escapeHtml(item.text);
      const analysis = renderBuzzinAnalysisHtml(item);
      return `<li><span class="buzzin-rank">${item.rank}</span><div class="buzzin-response-body"><strong>${escapeHtml(item.displayName)}</strong><p>${body}</p>${analysis}</div></li>`;
    })
    .join("");
}

function renderBuzzinAnalysisHtml(item) {
  if (item.pending || !item.text) return "";
  if (item.analysisStatus === "pending") {
    return `<p class="buzzin-analysis buzzin-analysis--pending">Analyzing response…</p>`;
  }
  if (item.analysisStatus === "error") {
    return `<p class="buzzin-analysis buzzin-analysis--error">${escapeHtml(item.analysis || "Analysis unavailable.")}</p>`;
  }
  if (item.analysis) {
    return `<p class="buzzin-analysis"><span class="buzzin-analysis-label">AI feedback</span>${escapeHtml(item.analysis)}</p>`;
  }
  return "";
}

function exerciseMetaLabel(exercise) {
  const parts = [];
  if (exercise?.subTitle) parts.push(exercise.subTitle);
  else if (exercise?.type) parts.push(exercise.type);
  if (exercise?.order != null) parts.push(`#${exercise.order}`);
  return parts.join(" · ");
}

/** Join preview layout id for an exercise type (join.html?preview=1). */
function joinPreviewLayoutForExercise(exercise) {
  if (isVideoExercise(exercise)) return "video";
  if (isBuzzinExercise(exercise)) return "buzzin-join";
  if (isLiveMcQuizExercise(exercise)) return "mc-question";
  return "mc-question";
}

function joinPreviewUrl(layoutId) {
  const url = new URL("/join.html", window.location.origin);
  url.searchParams.set("preview", "1");
  if (layoutId) url.searchParams.set("layout", layoutId);
  return `${url.pathname}${url.search}`;
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
