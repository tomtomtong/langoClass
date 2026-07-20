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

function buzzinSelectedStudent(payload) {
  return payload?.winners?.[0] || payload?.buzzes?.[0] || null;
}

function buzzinResponsesForDisplay(payload) {
  const student = buzzinSelectedStudent(payload);
  if (!student) return [];
  return (payload?.responses || [])
    .filter((response) => response.playerId === student.playerId)
    .slice(0, 1);
}

function buzzinCurrentTurnForDisplay(payload) {
  if (payload?.typingComplete) return null;
  const student = buzzinSelectedStudent(payload);
  if (!student) return null;
  const hasResponse = (payload?.responses || []).some(
    (response) => response.playerId === student.playerId
  );
  return hasResponse ? null : student;
}

function buzzinAvatarInitials(name) {
  const parts = String(name || "Student").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "S";
}

function buzzinBuzzElapsedSeconds(buzz, payload) {
  if (!buzz?.at) return null;
  const joinSeconds = payload?.joinSeconds || 20;
  const joinEndsAt = payload?.joinEndsAt;
  const startAt = joinEndsAt ? joinEndsAt - joinSeconds * 1000 : null;
  if (!startAt) return null;
  return Math.max(0, (buzz.at - startAt) / 1000);
}

function formatBuzzinBuzzTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  return `${seconds.toFixed(1)}s`;
}

function buzzinPointsFromAnalysis(analysis, maxPoints = 300) {
  const cap = Math.max(0, Number(maxPoints) || 0);
  if (!analysis || cap === 0) return 0;
  const text = String(analysis);
  const match = text.match(/(\d{1,3})\s*points?/i);
  if (match) return Math.min(cap, parseInt(match[1], 10));

  const categoryScores = Array.from(
    text.matchAll(/(?:correctness|completeness|fluency)\s*\(\s*(\d{1,3})(?:\s*\/\s*100)?\s*\)/gi),
    (item) => Math.min(100, parseInt(item[1], 10))
  );
  if (categoryScores.length) {
    const average = categoryScores.reduce((sum, score) => sum + score, 0) / categoryScores.length;
    return Math.round((average / 100) * cap);
  }

  return cap;
}

function splitBuzzinNameLines(name) {
  const parts = String(name || "Student").trim().split(/\s+/).filter(Boolean);
  return {
    line1: parts[0] || "Student",
    line2: parts.slice(1).join(" "),
  };
}

function renderHostBuzzinWinnerCard(container, student, payload, { isLive = false, animate = false } = {}) {
  if (!container) return;
  if (!student) {
    container.innerHTML = `<p class="host-buzzin-winner-empty">No one buzzed in.</p>`;
    return;
  }

  const { line1, line2 } = splitBuzzinNameLines(student.displayName);
  const buzzTime = formatBuzzinBuzzTime(buzzinBuzzElapsedSeconds(student, payload));
  const initials = buzzinAvatarInitials(student.displayName);
  const enterClass = animate ? " host-buzzin-winner-card--enter" : "";

  container.innerHTML = `<article class="host-buzzin-winner-card${isLive ? " is-live" : ""}${enterClass}">
    ${isLive ? `<span class="host-buzzin-winner-live"><span class="host-buzzin-winner-live-icon" aria-hidden="true"></span>LIVE</span>` : ""}
    <span class="host-buzzin-winner-medal" aria-hidden="true">1st</span>
    <div class="host-buzzin-chat-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
    <div class="host-buzzin-winner-copy">
      <p class="host-buzzin-winner-name">${escapeHtml(line1)}${line2 ? `<br />${escapeHtml(line2)}` : ""}</p>
      <p class="host-buzzin-winner-time">${escapeHtml(buzzTime)}</p>
    </div>
  </article>`;
}

function buzzinTypingIndicatorHtml() {
  return `<span class="host-buzzin-chat-typing" aria-label="Speaking"><span></span><span></span><span></span></span>`;
}

function renderHostBuzzinAnswerBubbleContent({ response, currentTurn, emptyText }) {
  if (response?.pending) {
    return buzzinTypingIndicatorHtml();
  }

  const text = String(response?.text || "").trim();
  if (text) {
    return `<p>${escapeHtml(text)}</p>`;
  }

  if (currentTurn) {
    return `<p>Buzzed in!</p>`;
  }

  return `<p>${escapeHtml(emptyText)}</p>`;
}

function scrollHostBuzzinChatToBottom(container) {
  if (!container) return;
  requestAnimationFrame(() => {
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  });
}

function renderHostBuzzinFeedbackChat(container, {
  topic = "",
  student = null,
  response = null,
  currentTurn = null,
  emptyText = "Waiting for answer…",
  animate = {},
} = {}) {
  if (!container) return;

  const topicText = String(topic || "").trim();
  const studentName = student?.displayName || currentTurn?.displayName || "Student";
  const initials = buzzinAvatarInitials(studentName);
  const isRecording = Boolean(response?.pending);
  const isWaitingToAnswer = Boolean(currentTurn && !response?.text && !isRecording);
  const pendingClass = isRecording || isWaitingToAnswer ? " host-buzzin-chat-bubble--pending" : "";

  let feedbackHtml = "";
  if (response && !response.pending && response.text) {
    if (response.analysisStatus === "pending") {
      feedbackHtml = `<div class="host-buzzin-chat-row host-buzzin-chat-row--teacher${animate.feedback ? " host-buzzin-chat-row--enter" : ""}">
        <div class="host-buzzin-chat-avatar host-buzzin-chat-avatar--teacher" aria-hidden="true">T</div>
        <div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--feedback host-buzzin-chat-bubble--analyzing"><p>Analyzing response…</p></div>
      </div>`;
    } else if (response.analysisStatus === "error") {
      feedbackHtml = `<div class="host-buzzin-chat-row host-buzzin-chat-row--teacher${animate.feedback ? " host-buzzin-chat-row--enter" : ""}">
        <div class="host-buzzin-chat-avatar host-buzzin-chat-avatar--teacher" aria-hidden="true">T</div>
        <div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--feedback"><p>${escapeHtml(response.analysis || "Analysis unavailable.")}</p></div>
      </div>`;
    } else if (response.analysis) {
      const replayBtn = response.analysisAudio
        ? `<button type="button" class="buzzin-analysis-play" data-buzzin-analysis-key="${escapeHtml(buzzinAnalysisAudioKey(response))}">Play feedback</button>`
        : "";
      feedbackHtml = `<div class="host-buzzin-chat-row host-buzzin-chat-row--teacher${animate.feedback ? " host-buzzin-chat-row--enter" : ""}">
        <div class="host-buzzin-chat-avatar host-buzzin-chat-avatar--teacher" aria-hidden="true">T</div>
        <div class="host-buzzin-chat-feedback-group">
          <div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--feedback">
            <p>${escapeHtml(response.analysis)}</p>
            ${replayBtn}
          </div>
        </div>
      </div>`;
    }
  }

  const topicEnter = animate.topic ? " host-buzzin-chat-row--enter" : "";
  const answerEnter = animate.answer ? " host-buzzin-chat-row--enter" : "";

  if (!topicText && !student && !currentTurn) {
    container.innerHTML = `<p class="host-buzzin-winner-empty">${escapeHtml(emptyText)}</p>`;
    return;
  }

  container.innerHTML = `
    ${topicText ? `<div class="host-buzzin-chat-row host-buzzin-chat-row--teacher${topicEnter}">
      <div class="host-buzzin-chat-avatar host-buzzin-chat-avatar--teacher" aria-hidden="true">T</div>
      <div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--question"><p>${escapeHtml(topicText)}</p></div>
    </div>` : ""}
    ${student || currentTurn ? `<div class="host-buzzin-chat-row host-buzzin-chat-row--student${answerEnter}">
      <div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--answer${pendingClass}">
        ${renderHostBuzzinAnswerBubbleContent({ response, currentTurn, emptyText })}
      </div>
      <div class="host-buzzin-chat-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
    </div>` : ""}
    ${feedbackHtml}`;

  scrollHostBuzzinChatToBottom(container);
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
    const replayBtn = item.analysisAudio
      ? `<button type="button" class="btn buzzin-analysis-play" data-buzzin-analysis-key="${escapeHtml(buzzinAnalysisAudioKey(item))}">Play feedback</button>`
      : "";
    return `<p class="buzzin-analysis"><span class="buzzin-analysis-label">AI feedback</span>${escapeHtml(item.analysis)}${replayBtn}</p>`;
  }
  return "";
}

function buzzinAnalysisAudioKey(item) {
  return `${item.playerId || ""}:${item.at || 0}`;
}

let buzzinAnalysisAudioEl = null;

function playBuzzinAnalysisAudio(item) {
  const base64 = item?.analysisAudio;
  if (!base64) return;

  const format = String(item.analysisAudioFormat || "mp3").toLowerCase();
  const mime = format === "wav" ? "audio/wav" : "audio/mpeg";
  const src = `data:${mime};base64,${base64}`;

  if (!buzzinAnalysisAudioEl) {
    buzzinAnalysisAudioEl = new Audio();
  }

  buzzinAnalysisAudioEl.pause();
  buzzinAnalysisAudioEl.src = src;
  const playPromise = buzzinAnalysisAudioEl.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      /* Autoplay may be blocked until user gesture. */
    });
  }
}

function playNewBuzzinAnalysisAudio(responses, playedKeys) {
  if (!Array.isArray(responses) || !playedKeys) return;

  for (const item of responses) {
    if (item.analysisStatus !== "done" || !item.analysisAudio) continue;
    const key = buzzinAnalysisAudioKey(item);
    if (playedKeys.has(key)) continue;
    playedKeys.add(key);
    playBuzzinAnalysisAudio(item);
  }
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
