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

function videoUrlFromExercise(exercise) {
  if (!exercise || !isVideoExercise(exercise)) return null;
  const item = exercise?.items?.[0];
  return item?.videoUrl || item?.video_url || null;
}

const CAPTION_LANGUAGE_OPTIONS = [
  { code: "en", label: "EN", name: "English" },
  { code: "zh", label: "中文", name: "Chinese" },
  { code: "yue", label: "粵", name: "Cantonese" },
  { code: "ja", label: "日本語", name: "Japanese" },
  { code: "ko", label: "한국어", name: "Korean" },
];

function normalizeCaptionLanguage(value, fallback = "en") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  if (CAPTION_LANGUAGE_OPTIONS.some((entry) => entry.code === normalized)) {
    return normalized;
  }
  const nextFallback = String(fallback || "en")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return CAPTION_LANGUAGE_OPTIONS.some((entry) => entry.code === nextFallback)
    ? nextFallback
    : "en";
}

function captionLanguageMeta(code) {
  const language = normalizeCaptionLanguage(code);
  return (
    CAPTION_LANGUAGE_OPTIONS.find((entry) => entry.code === language) || {
      code: language,
      label: language.toUpperCase(),
      name: language,
    }
  );
}

function captionTracksFromExercise(exercise) {
  if (!exercise || !isVideoExercise(exercise)) return [];
  const item = exercise?.items?.[0] || {};
  const tracks = [];
  const seen = new Set();

  const pushTrack = (languageRaw, urlRaw) => {
    const url = String(urlRaw || "").trim();
    const language = normalizeCaptionLanguage(languageRaw);
    if (!url || seen.has(language)) return;
    seen.add(language);
    const meta = captionLanguageMeta(language);
    tracks.push({
      language,
      label: meta.label,
      name: meta.name,
      url,
    });
  };

  (Array.isArray(item.captionTracks) ? item.captionTracks : []).forEach((track) => {
    pushTrack(track?.language || track?.lang || track?.code, track?.url || track?.captionUrl);
  });

  const legacyUrl =
    item.captionUrl || item.subtitleUrl || item.captionsUrl || item.caption_url || "";
  if (legacyUrl) {
    pushTrack(item.captionLanguage || item.captionLang || "en", legacyUrl);
  }

  return tracks;
}

function captionUrlFromExercise(exercise, preferredLanguage) {
  const tracks = captionTracksFromExercise(exercise);
  if (!tracks.length) return null;
  if (preferredLanguage) {
    const language = normalizeCaptionLanguage(preferredLanguage);
    const match = tracks.find((track) => track.language === language);
    if (match) return match.url;
  }
  return tracks[0].url;
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

  const fromTopics = items
    .map((item) => normalizeBuzzinQuestionText(item?.topic || item?.title || item?.question || item?.text))
    .filter(Boolean);
  if (fromTopics.length) return fromTopics;

  const first = items[0] || {};
  const fromFirstItem = (first.questions || [])
    .map(normalizeBuzzinQuestionText)
    .filter(Boolean);
  if (fromFirstItem.length) return fromFirstItem;

  const topLevel = (exercise?.questions || [])
    .map(normalizeBuzzinQuestionText)
    .filter(Boolean);
  if (topLevel.length) return topLevel;

  return [];
}

function buzzinFromExercise(exercise) {
  if (!exercise || !isBuzzinExercise(exercise)) return null;

  const topics = collectBuzzinQuestions(exercise);
  const topic = String(topics[0] || exercise.title || "").trim();
  if (!topic) return null;

  return {
    topic,
    topics,
    questionIndex: 0,
    totalQuestions: Math.max(1, topics.length),
  };
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

function buzzinAvatarHue(name) {
  let hash = 0;
  for (const character of String(name || "")) {
    hash = (hash * 31 + character.codePointAt(0)) % 360;
  }
  return hash;
}

function buzzinLuckyDrawAvatarHtml(name) {
  const safeName = escapeHtml(name || "Student");
  const initials = escapeHtml(buzzinAvatarInitials(name));
  const hue = buzzinAvatarHue(name);
  return `<div class="host-buzzin-lucky-draw__avatar" role="img" aria-label="${safeName} avatar" style="--lucky-avatar-hue: ${hue}">
    <span aria-hidden="true">${initials}</span>
  </div>`;
}

function buildBuzzinAnswerAnnouncement(topic, displayName) {
  const question = String(topic || "").trim() || "your question";
  const name = String(displayName || "Student").trim() || "Student";
  return `Today's question is: ${question} ${name}, you're up! On your device, tap the Record button, speak your answer, then tap again to submit.`;
}

function buildBuzzinLuckyDrawAnnouncement(topic, displayName) {
  return buildBuzzinAnswerAnnouncement(topic, displayName);
}

function getHostBuzzinTopicText() {
  const feedbackTopic = $("#host-buzzin-feedback-topic");
  const questionTopic = $("#host-buzzin-topic");
  return String(feedbackTopic?.textContent || questionTopic?.textContent || "").trim();
}

function renderHostBuzzinLuckyStarCard(container, student, { animate = false } = {}) {
  if (!container) return;
  if (!student) {
    container.innerHTML = `<p class="host-buzzin-winner-empty">No lucky star yet.</p>`;
    return;
  }

  const { line1, line2 } = splitBuzzinNameLines(student.displayName);
  const initials = buzzinAvatarInitials(student.displayName);
  const hue = buzzinAvatarHue(student.displayName);
  const enterClass = animate ? " host-buzzin-winner-card--enter" : "";

  container.innerHTML = `<article class="host-buzzin-winner-card host-buzzin-winner-card--lucky${enterClass}">
    <div class="host-buzzin-chat-avatar host-buzzin-chat-avatar--lucky" style="--lucky-avatar-hue: ${hue}" aria-hidden="true">${escapeHtml(initials)}</div>
    <div class="host-buzzin-winner-copy">
      <p class="host-buzzin-winner-name">${escapeHtml(line1)}${line2 ? `<br />${escapeHtml(line2)}` : ""}</p>
    </div>
  </article>`;
}

function buzzinBuzzElapsedSeconds(buzz, payload) {
  const elapsedMs = Number(buzz?.elapsedMs);
  if (Number.isFinite(elapsedMs)) return Math.max(0, elapsedMs / 1000);
  if (!buzz?.at) return null;
  const openedAt = Number(payload?.joinOpenedAt) || 0;
  if (openedAt) return Math.max(0, (buzz.at - openedAt) / 1000);
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

function uncleTommySpriteHtml(extraClass = "") {
  const cls = ["uncle-tommy-sprite", extraClass].filter(Boolean).join(" ");
  return `<div class="${cls}" data-uncle-tommy-sprite aria-hidden="true"><span class="uncle-tommy-sprite__clip"><span class="uncle-tommy-sprite__film"></span></span></div>`;
}

function buzzinTeacherAvatarHtml() {
  return `<div class="host-buzzin-chat-avatar host-buzzin-chat-avatar--teacher" aria-hidden="true">
    ${uncleTommySpriteHtml("uncle-tommy-sprite--avatar")}
  </div>`;
}

function renderHostBuzzinAnswerBubbleContent({ response, currentTurn, emptyText }) {
  if (response?.pending) {
    return buzzinTypingIndicatorHtml();
  }

  const text = String(response?.text || "").trim();
  if (text) {
    return `<p>${escapeHtml(text)}</p>${buzzinResponseRecordingPlayButtonHtml(response)}`;
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

function buzzinQuestionBubbleHtml(topicText, askedName) {
  const topic = String(topicText || "").trim();
  const name = String(askedName || "").trim();
  if (!topic) return "";
  const body = name
    ? `<p><strong>${escapeHtml(name)}</strong> — ${escapeHtml(topic)}</p>`
    : `<p>${escapeHtml(topic)}</p>`;
  return `<div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--question">${body}</div>`;
}

function renderHostBuzzinFeedbackChat(container, {
  topic = "",
  student = null,
  response = null,
  currentTurn = null,
  emptyText = uiT("buzzin.waitingAnswer"),
  animate = {},
} = {}) {
  if (!container) return;

  const topicText = String(topic || "").trim();
  const studentName = student?.displayName || currentTurn?.displayName || "Student";
  const askedName = String(student?.displayName || currentTurn?.displayName || "").trim();
  const initials = buzzinAvatarInitials(studentName);
  const isRecording = Boolean(response?.pending);
  const isWaitingToAnswer = Boolean(currentTurn && !response?.text && !isRecording);
  const pendingClass = isRecording || isWaitingToAnswer ? " host-buzzin-chat-bubble--pending" : "";

  let feedbackHtml = "";
  if (response && !response.pending && response.text) {
    if (response.analysisStatus === "pending") {
      feedbackHtml = `<div class="host-buzzin-chat-row host-buzzin-chat-row--teacher${animate.feedback ? " host-buzzin-chat-row--enter" : ""}">
        ${buzzinTeacherAvatarHtml()}
        <div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--feedback host-buzzin-chat-bubble--analyzing"><p>Analyzing response…</p></div>
      </div>`;
    } else if (response.analysisStatus === "error") {
      feedbackHtml = `<div class="host-buzzin-chat-row host-buzzin-chat-row--teacher${animate.feedback ? " host-buzzin-chat-row--enter" : ""}">
        ${buzzinTeacherAvatarHtml()}
        <div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--feedback"><p>${escapeHtml(response.analysis || uiT("buzzin.analysisUnavailable"))}</p></div>
      </div>`;
    } else if (response.analysis) {
      feedbackHtml = `<div class="host-buzzin-chat-row host-buzzin-chat-row--teacher${animate.feedback ? " host-buzzin-chat-row--enter" : ""}">
        ${buzzinTeacherAvatarHtml()}
        <div class="host-buzzin-chat-feedback-group">
          ${buzzinAnswerVerdictBadgeHtml(response)}
          <div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--feedback host-buzzin-chat-bubble--scores">
            ${renderBuzzinAnalysisScorePiesHtml(response.analysis)}
          </div>
          ${buzzinSpokenFeedbackBubbleHtml(response)}
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
      ${buzzinTeacherAvatarHtml()}
      ${buzzinQuestionBubbleHtml(topicText, askedName)}
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
    : `<li class="hint">${escapeHtml(emptyText || uiT("buzzin.waitBuzzList"))}</li>`;
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
    listEl.innerHTML = `<li class="hint">${escapeHtml(emptyText || uiT("buzzin.waitingAnswer"))}</li>`;
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const body = item.pending
        ? `<span class="buzzin-response-pending">${uiT("buzzin.speaking")}</span>`
        : `${escapeHtml(item.text)}${buzzinResponseRecordingPlayButtonHtml(item)}`;
      const analysis = renderBuzzinAnalysisHtml(item);
      return `<li><span class="buzzin-rank">${item.rank}</span><div class="buzzin-response-body"><strong>${escapeHtml(item.displayName)}</strong><p>${body}</p>${analysis}</div></li>`;
    })
    .join("");
}

const BUZZIN_SCORE_METRICS = [
  { key: "correctness", labelKey: "buzzin.scoreCorrectness", pattern: /(?:Correctness|正確度|正确度)[^\d]{0,24}(\d{1,3})/i, color: "#45c937" },
  { key: "completeness", labelKey: "buzzin.scoreCompleteness", pattern: /(?:Completeness|完整度)[^\d]{0,24}(\d{1,3})/i, color: "#15c4f8" },
  { key: "fluency", labelKey: "buzzin.scoreFluency", pattern: /(?:Fluency|流暢度|流畅度)[^\d]{0,24}(\d{1,3})/i, color: "#f59e0b" },
];

function buzzinAnswerVerdictBadgeHtml(item) {
  const verdict = String(item?.answerVerdict || "").trim().toLowerCase();
  if (!verdict) return "";
  const label =
    verdict === "correct"
      ? uiT("buzzin.verdictCorrect")
      : verdict === "incorrect"
        ? uiT("buzzin.verdictIncorrect")
        : verdict === "partial"
          ? uiT("buzzin.verdictPartial")
          : "";
  if (!label) return "";
  return `<div class="host-buzzin-answer-verdict host-buzzin-answer-verdict--${escapeHtml(verdict)}" role="status">${escapeHtml(label)}</div>`;
}

function parseBuzzinAnalysisScores(analysis) {
  const text = String(analysis || "");
  return BUZZIN_SCORE_METRICS.map((metric) => {
    const match = text.match(metric.pattern);
    if (!match) return null;
    return {
      ...metric,
      label: uiT(metric.labelKey),
      score: Math.max(0, Math.min(100, Number(match[1]) || 0)),
    };
  }).filter(Boolean);
}

function buzzinScorePieHtml({ label, score, color }) {
  return `<div class="buzzin-score-pie">
    <div class="buzzin-score-pie__chart" style="--score: ${score}; --pie-color: ${color}" role="img" aria-label="${escapeHtml(label)} ${score} out of 100">
      <div class="buzzin-score-pie__ring" aria-hidden="true"></div>
      <span class="buzzin-score-pie__value">${score}</span>
    </div>
    <span class="buzzin-score-pie__label">${escapeHtml(label)}</span>
  </div>`;
}

function renderBuzzinAnalysisScorePiesHtml(analysis) {
  const metrics = parseBuzzinAnalysisScores(analysis);
  if (!metrics.length) {
    return `<p>${escapeHtml(analysis || "")}</p>`;
  }
  return `<div class="buzzin-score-pies" aria-label="AI feedback scores">
    ${metrics.map((metric) => buzzinScorePieHtml(metric)).join("")}
  </div>`;
}

function renderBuzzinAnalysisHtml(item) {
  if (item.pending || !item.text) return "";
  if (item.analysisStatus === "pending") {
    return `<p class="buzzin-analysis buzzin-analysis--pending">${uiT("buzzin.analyzing")}</p>`;
  }
  if (item.analysisStatus === "error") {
    return `<p class="buzzin-analysis buzzin-analysis--error">${escapeHtml(item.analysis || uiT("buzzin.analysisUnavailable"))}</p>`;
  }
  if (item.analysis) {
    const spoken = String(item.spokenFeedback || "").trim();
    return `<div class="buzzin-analysis"><span class="buzzin-analysis-label">${uiT("buzzin.aiFeedback")}</span>${buzzinAnswerVerdictBadgeHtml(item)}${renderBuzzinAnalysisScorePiesHtml(item.analysis)}${spoken ? `<p class="buzzin-spoken-feedback">${escapeHtml(spoken)}</p>` : ""}${buzzinSpokenFeedbackPlayButtonHtml(item)}</div>`;
  }
  return "";
}

function buzzinSpokenFeedbackAudioKey(item) {
  return `${item.playerId || ""}:${item.at || 0}`;
}

function buzzinSpokenFeedbackPlayButtonHtml(item) {
  if (!item?.analysisAudio) return "";
  const key = buzzinSpokenFeedbackAudioKey(item);
  return `<button type="button" class="buzzin-analysis-play" data-buzzin-play-feedback="${escapeHtml(key)}" aria-label="${uiT("buzzin.playFeedback")}">▶ ${uiT("buzzin.playFeedback")}</button>`;
}

function buzzinSpokenFeedbackBubbleHtml(item) {
  const text = String(item?.spokenFeedback || "").trim();
  if (!text && !item?.analysisAudio) return "";
  return `<div class="host-buzzin-chat-bubble host-buzzin-chat-bubble--feedback host-buzzin-chat-bubble--spoken">
    ${text ? `<p>${escapeHtml(text)}</p>` : ""}
    ${buzzinSpokenFeedbackPlayButtonHtml(item)}
  </div>`;
}

function buzzinResponseRecordingPlayButtonHtml(item) {
  if (!item?.responseAudio) return "";
  const key = buzzinSpokenFeedbackAudioKey(item);
  return `<button type="button" class="buzzin-analysis-play buzzin-response-play" data-buzzin-play-recording="${escapeHtml(key)}" aria-label="${uiT("buzzin.playRecording")}">▶ ${uiT("buzzin.playRecording")}</button>`;
}

function setupBuzzinSpokenFeedbackPlayDelegation(container, getResponses) {
  if (!container || container.dataset.buzzinPlayBound === "1") return;
  container.dataset.buzzinPlayBound = "1";
  container.addEventListener("click", (event) => {
    const responses = typeof getResponses === "function" ? getResponses() : [];
    const recordingBtn = event.target.closest("[data-buzzin-play-recording]");
    if (recordingBtn && container.contains(recordingBtn)) {
      const key = recordingBtn.getAttribute("data-buzzin-play-recording");
      const item = responses.find((response) => buzzinSpokenFeedbackAudioKey(response) === key);
      if (item) playBuzzinResponseRecordingAudio(item);
      return;
    }

    const feedbackBtn = event.target.closest("[data-buzzin-play-feedback]");
    if (!feedbackBtn || !container.contains(feedbackBtn)) return;
    const key = feedbackBtn.getAttribute("data-buzzin-play-feedback");
    const item = responses.find((response) => buzzinSpokenFeedbackAudioKey(response) === key);
    if (item) playBuzzinSpokenFeedbackAudio(item);
  });
}

let buzzinPlaybackAudioEl = null;
let buzzinPlaybackFinish = null;
let buzzinSpeechBgmDuckDepth = 0;
let uncleTommySpeakToken = 0;
const BUZZIN_SPEECH_BGM_VOLUME = 0.06;
const UNCLE_TOMMY_TTS_PLAYBACK_GAIN = 4.5;

function getBuzzinSpeechBgmDuckVolume() {
  if (typeof getHostSpeechBgmDuckVolume === "function") {
    return getHostSpeechBgmDuckVolume();
  }
  return BUZZIN_SPEECH_BGM_VOLUME;
}

function beginBuzzinSpeechBgmDuck() {
  if (buzzinSpeechBgmDuckDepth === 0 && typeof fadeHostBgmTo === "function") {
    fadeHostBgmTo(getBuzzinSpeechBgmDuckVolume());
  }
  buzzinSpeechBgmDuckDepth += 1;
}

function endBuzzinSpeechBgmDuck() {
  if (buzzinSpeechBgmDuckDepth <= 0) return;
  buzzinSpeechBgmDuckDepth -= 1;
  if (
    buzzinSpeechBgmDuckDepth === 0 &&
    typeof fadeHostBgmTo === "function" &&
    typeof HOST_BGM_VOLUME === "number"
  ) {
    fadeHostBgmTo(HOST_BGM_VOLUME);
  }
}

function buzzinAudioMimeFromFormat(format) {
  const normalized = String(format || "mp3").toLowerCase().replace(/^\./, "");
  if (normalized === "wav") return "audio/wav";
  if (normalized === "webm") return "audio/webm";
  if (normalized === "m4a" || normalized === "mp4") return "audio/mp4";
  return "audio/mpeg";
}

function stopBuzzinBase64Audio() {
  if (buzzinPlaybackFinish) {
    const finish = buzzinPlaybackFinish;
    buzzinPlaybackFinish = null;
    finish();
  }
  buzzinActiveGainSetup = null;
  buzzinActiveBaseGain = 1;
  buzzinActiveUseEffectsVolume = true;
  if (!buzzinPlaybackAudioEl) return;
  buzzinPlaybackAudioEl.onended = null;
  buzzinPlaybackAudioEl.onerror = null;
  buzzinPlaybackAudioEl.pause();
  buzzinPlaybackAudioEl.removeAttribute("src");
}

function getHostSoundEffectsPlaybackVolume() {
  if (typeof hostSoundEffectsMuted === "boolean" && hostSoundEffectsMuted) return 0;
  if (typeof hostSoundEffectsVolume === "number" && Number.isFinite(hostSoundEffectsVolume)) {
    return Math.max(0, Math.min(1, hostSoundEffectsVolume));
  }
  return 1;
}

/** Uncle Tommy speech stays loud in the classroom; only the global mute stops it. */
function getUncleTommyTtsPlaybackVolume() {
  if (typeof hostSoundEffectsMuted === "boolean" && hostSoundEffectsMuted) return 0;
  return 1;
}

function attachBuzzinPlaybackGain(audio, gain = 1) {
  const normalizedGain = Number.isFinite(gain) ? Math.max(0, gain) : 1;
  if (normalizedGain <= 1) {
    audio.volume = normalizedGain;
    return {
      setGain(nextGain) {
        const value = Number.isFinite(nextGain) ? Math.max(0, nextGain) : 1;
        audio.volume = Math.min(1, value);
      },
      release() {},
      resumeIfNeeded() {},
    };
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    audio.volume = 1;
    return {
      setGain() {},
      release() {},
      resumeIfNeeded() {},
    };
  }

  try {
    const audioContext = new AudioContextCtor();
    const sourceNode = audioContext.createMediaElementSource(audio);
    const gainNode = audioContext.createGain();
    audio.volume = 1;
    gainNode.gain.value = normalizedGain;
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
    return {
      setGain(nextGain) {
        const value = Number.isFinite(nextGain) ? Math.max(0, nextGain) : 1;
        gainNode.gain.value = value;
      },
      release() {
        try {
          sourceNode.disconnect();
          gainNode.disconnect();
          if (audioContext.state !== "closed") void audioContext.close();
        } catch {
          /* Ignore teardown errors after playback ends. */
        }
      },
      resumeIfNeeded() {
        if (audioContext.state === "suspended") void audioContext.resume();
      },
    };
  } catch {
    audio.volume = 1;
    return {
      setGain() {},
      release() {},
      resumeIfNeeded() {},
    };
  }
}

let buzzinActiveGainSetup = null;
let buzzinActiveBaseGain = 1;
let buzzinActiveUseEffectsVolume = true;

function syncBuzzinPlaybackToHostSoundEffects() {
  if (!buzzinActiveGainSetup) return;
  const effectsVolume = buzzinActiveUseEffectsVolume
    ? getHostSoundEffectsPlaybackVolume()
    : getUncleTommyTtsPlaybackVolume();
  if (effectsVolume <= 0) {
    stopBuzzinBase64Audio();
    return;
  }
  buzzinActiveGainSetup.setGain(buzzinActiveBaseGain * effectsVolume);
}

function playBuzzinBase64Audio(base64, format, { duckBgm = false, gain = 1, useEffectsVolume = true } = {}) {
  if (!base64) return Promise.resolve();

  const effectsVolume = useEffectsVolume
    ? getHostSoundEffectsPlaybackVolume()
    : getUncleTommyTtsPlaybackVolume();
  if (effectsVolume <= 0) return Promise.resolve();

  const mime = buzzinAudioMimeFromFormat(format);
  stopBuzzinBase64Audio();
  if (duckBgm) beginBuzzinSpeechBgmDuck();

  const baseGain = Number.isFinite(gain) ? Math.max(0, gain) : 1;
  buzzinActiveBaseGain = baseGain;
  buzzinActiveUseEffectsVolume = useEffectsVolume;

  return new Promise((resolve) => {
    const audio = new Audio();
    const gainSetup = attachBuzzinPlaybackGain(audio, baseGain * effectsVolume);
    buzzinActiveGainSetup = gainSetup;
    buzzinPlaybackAudioEl = audio;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (buzzinPlaybackFinish === finish) buzzinPlaybackFinish = null;
      if (buzzinActiveGainSetup === gainSetup) {
        buzzinActiveGainSetup = null;
        buzzinActiveBaseGain = 1;
        buzzinActiveUseEffectsVolume = true;
      }
      audio.onended = null;
      audio.onerror = null;
      gainSetup.release();
      if (duckBgm) endBuzzinSpeechBgmDuck();
      resolve();
    };

    buzzinPlaybackFinish = finish;
    audio.onended = finish;
    audio.onerror = finish;
    audio.src = `data:${mime};base64,${base64}`;
    const playPromise = audio.play();
    playPromise?.then?.(() => gainSetup.resumeIfNeeded())?.catch?.(() => {
      /* Autoplay may be blocked until the host interacts with the page. */
      finish();
    });
  });
}

function setUncleTommySpeaking(speaking) {
  document.documentElement.classList.toggle("uncle-tommy-is-speaking", Boolean(speaking));
}

/** Host-only Uncle Tommy TTS playback. Resolves when audio ends or fails. */
function playUncleTommyTts(base64, format) {
  if (!base64) return Promise.resolve();
  if (getUncleTommyTtsPlaybackVolume() <= 0) return Promise.resolve();

  const token = ++uncleTommySpeakToken;
  setUncleTommySpeaking(true);
  return playBuzzinBase64Audio(base64, format, {
    duckBgm: true,
    gain: UNCLE_TOMMY_TTS_PLAYBACK_GAIN,
    useEffectsVolume: false,
  }).finally(() => {
    if (token === uncleTommySpeakToken) setUncleTommySpeaking(false);
  });
}

function playBuzzinSpokenFeedbackAudio(item) {
  return playUncleTommyTts(item?.analysisAudio, item?.analysisAudioFormat || "mp3");
}

function playBuzzinResponseRecordingAudio(item) {
  playBuzzinBase64Audio(item?.responseAudio, item?.responseAudioFormat || "wav");
}

function playNewBuzzinSpokenFeedbackAudio(responses, playedKeys) {
  if (!Array.isArray(responses) || !playedKeys) return;

  for (const item of responses) {
    if (item.analysisStatus !== "done" || !item.analysisAudio) continue;
    const key = buzzinSpokenFeedbackAudioKey(item);
    if (playedKeys.has(key)) continue;
    playedKeys.add(key);
    playBuzzinSpokenFeedbackAudio(item);
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
  const url = new URL(typeof langoJoinPagePath === "function" ? langoJoinPagePath() : "/join.html", window.location.origin);
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

const SECTION_TIMING = {
  QUESTION_PREVIEW_SECONDS: 5,
  MC_RESULTS_SECONDS: 12,
  FAST_MC_BETWEEN_SECONDS: 2,
  BUZZIN_JOIN_SECONDS: 20,
  BUZZIN_ANSWER_SECONDS: 45,
  BUZZIN_FEEDBACK_SECONDS: 20,
  VIDEO_DEFAULT_SECONDS: 180,
  BETWEEN_EXERCISES_SECONDS: 20,
};

function estimateMcQuestionSeconds(item, fastMode) {
  const timeLimitRaw = Number(item?.timeLimit ?? item?.duration_seconds);
  const timeLimit = Number.isFinite(timeLimitRaw)
    ? Math.max(5, Math.min(60, Math.round(timeLimitRaw)))
    : fastMode
      ? 10
      : 15;
  const transition = fastMode
    ? SECTION_TIMING.FAST_MC_BETWEEN_SECONDS
    : SECTION_TIMING.MC_RESULTS_SECONDS;
  return SECTION_TIMING.QUESTION_PREVIEW_SECONDS + timeLimit + transition;
}

function isCountableMcItem(item) {
  const text = String(item?.title || item?.question || "").trim();
  const options = (item?.options || [])
    .map((option) => String(option?.text || "").trim())
    .filter(Boolean);
  return Boolean(text && options.length >= 2);
}

function estimateExerciseDurationSeconds(exercise) {
  if (!exercise) return 0;
  const type = normalizeExerciseType(exercise.type);
  const items = Array.isArray(exercise.items) ? exercise.items : [];

  if (type === "video") {
    const item = items[0] || {};
    const duration = Number(
      item.durationSeconds ?? item.duration_seconds ?? item.videoDuration ?? item.duration
    );
    return Number.isFinite(duration) && duration > 0
      ? duration
      : SECTION_TIMING.VIDEO_DEFAULT_SECONDS;
  }

  if (type === "buzzin") {
    const topics = items.filter((item) => String(item?.topic || item?.title || "").trim());
    if (!topics.length) return 0;
    const perTopic =
      SECTION_TIMING.BUZZIN_JOIN_SECONDS +
      SECTION_TIMING.BUZZIN_ANSWER_SECONDS +
      SECTION_TIMING.BUZZIN_FEEDBACK_SECONDS;
    return topics.length * perTopic;
  }

  if (type === "fastmcquiz") {
    return items
      .filter(isCountableMcItem)
      .reduce((sum, item) => sum + estimateMcQuestionSeconds(item, true), 0);
  }

  if (type === "mcquiz") {
    return items
      .filter(isCountableMcItem)
      .reduce((sum, item) => sum + estimateMcQuestionSeconds(item, false), 0);
  }

  return 0;
}

function estimateSectionDurationSeconds(exercises) {
  const list = Array.isArray(exercises) ? exercises : [];
  if (!list.length) return 0;
  const exerciseTotal = list.reduce(
    (sum, exercise) => sum + estimateExerciseDurationSeconds(exercise),
    0
  );
  const between = Math.max(0, list.length - 1) * SECTION_TIMING.BETWEEN_EXERCISES_SECONDS;
  return exerciseTotal + between;
}

function formatSectionDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total <= 0) return "—";
  if (total < 60) return `~${total} sec`;
  const mins = Math.round(total / 60);
  if (mins < 60) return `~${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `~${hours} hr ${rem} min` : `~${hours} hr`;
}
