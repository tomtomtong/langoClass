/** Socket.IO live exercises for Lango host — content from CMS course detail. */
let roomQuizSocket = null;
let roomQuizCurrentQuestion = null;
let roomQuizFastMode = false;

const HOST_MCQ_OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];
const HOST_MCQ_OPTION_COLORS = LANGO_MCQ_OPTION_COLORS;

const HOST_ELDERLY_OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

function hostMcqOptionLabels() {
  return isHkElderlyVariant() ? HOST_ELDERLY_OPTION_LABELS : HOST_MCQ_OPTION_LABELS;
}

function hostMcqOptionColors() {
  return isHkElderlyVariant() ? KAHOOT_OPTION_COLORS : HOST_MCQ_OPTION_COLORS;
}
let hostBuzzinUiReady = false;
let hostBuzzinRoomId = null;
let hostBuzzinRoundId = null;
let hostBuzzinJoinTimer = null;
let hostBuzzinLastResponses = [];
const hostBuzzinPlayedSpokenFeedbackAudio = new Set();
const hostBuzzinReviewSequencePlayed = new Set();
// Responses whose whole review (recording replay + spoken feedback) has finished.
const hostBuzzinReviewSequenceDone = new Set();
const hostBuzzinFeedbackVisible = new Set();
let hostBuzzinActiveExercise = null;
let hostBuzzinLastPayload = null;
let hostBuzzinCorrectAnswerRevealed = false;
let hostBuzzinAnswerKeyJustRevealed = false;
let hostBuzzinActiveScreenPhase = null;
let hostBuzzinExercisePoints = 300;
let hostBuzzinTopicSpeaking = false;
let hostQuestionTtsToken = 0;
let hostBuzzinLuckyDrawRunning = false;
let hostBuzzinLuckyDrawScramble = 0;
let hostBuzzinLuckyStar = null;
let hostBuzzinHasNextQuestion = false;
let hostBuzzinAdvancingQuestion = false;
const hostBuzzinPlayedAnnouncements = new Set();
const hostBuzzinFeedbackAnim = {
  topic: "",
  answerKey: "",
  feedbackKey: "",
  winnerKey: "",
};

function resetHostBuzzinFeedbackAnim() {
  hostBuzzinFeedbackAnim.topic = "";
  hostBuzzinFeedbackAnim.answerKey = "";
  hostBuzzinFeedbackAnim.feedbackKey = "";
  hostBuzzinFeedbackAnim.winnerKey = "";
  hostBuzzinLuckyStar = null;
  hostBuzzinPlayedAnnouncements.clear();
  hostBuzzinReviewSequencePlayed.clear();
  hostBuzzinReviewSequenceDone.clear();
  hostBuzzinFeedbackVisible.clear();
  hostBuzzinCorrectAnswerRevealed = false;
  setHostBuzzinLeaderboardMode("winner");
  resetHostBuzzinLuckyDrawUi();
  syncHostBuzzinShowAnswerButton(null);
  syncHostBuzzinNextActions(null);
}

function hostBuzzinFeedbackAnimateFlags(payload, selectedStudent, currentTurn, responses) {
  const topic = String(payload?.topic || "").trim();
  const items = Array.isArray(responses) ? responses : responses ? [responses] : [];
  const answerKey =
    items.map((entry) => `${entry.at || 0}:${entry.text || ""}`).join("|") +
    (currentTurn ? "|pending" : "");
  const feedbackKey = items
    .map(
      (entry) =>
        `${entry.at || 0}:${entry.analysisStatus || "none"}:${entry.answerVerdict || ""}:${entry.analysis || ""}:${entry.spokenFeedback || ""}`
    )
    .join("|");

  const flags = {
    topic: Boolean(topic && topic !== hostBuzzinFeedbackAnim.topic),
    answer: Boolean(answerKey && answerKey !== hostBuzzinFeedbackAnim.answerKey),
    feedback: Boolean(feedbackKey && feedbackKey !== hostBuzzinFeedbackAnim.feedbackKey),
    winner: Boolean(
      selectedStudent?.playerId &&
        selectedStudent.playerId !== hostBuzzinFeedbackAnim.winnerKey
    ),
  };

  hostBuzzinFeedbackAnim.topic = topic;
  hostBuzzinFeedbackAnim.answerKey = answerKey;
  hostBuzzinFeedbackAnim.feedbackKey = feedbackKey;
  if (selectedStudent?.playerId) {
    hostBuzzinFeedbackAnim.winnerKey = selectedStudent.playerId;
  }

  return flags;
}

// A long question shrinks to fit the card instead of pushing the countdown
// under the Buzz In button. Re-run when the countdown shows or hides.
function fitHostBuzzinQuestion() {
  fitTextToBoxSoon({ min: 18 }, $("#host-buzzin-topic"));
}

function syncHostBuzzinTopic(topic, meta = null) {
  const text = String(topic || "").trim();
  const questionTopic = $("#host-buzzin-topic");
  const feedbackTopic = $("#host-buzzin-feedback-topic");
  if (questionTopic) questionTopic.textContent = text;
  if (feedbackTopic) feedbackTopic.textContent = text;
  fitHostBuzzinQuestion();

  const total = Math.max(1, Number(meta?.totalQuestions) || 1);
  const index = Math.min(Math.max(0, Number(meta?.questionIndex) || 0), total - 1);
  const label =
    total > 1 ? uiT("buzzin.titleN", { n: index + 1, total: total }) : uiT("buzzin.title");

  document
    .querySelectorAll(
      "#screen-host-buzzin .host-buzzin-title, #screen-host-buzzin-feedback .host-buzzin-feedback-title, #screen-host-buzzin-empty .host-buzzin-title"
    )
    .forEach((el) => {
      el.textContent = label;
    });

  updateHostBuzzinAdvanceButtons(Boolean(meta?.hasNextQuestion));
}

function syncHostBuzzinQuestionImage(imageUrl) {
  const url = resolvedMediaUrl(imageUrl);
  $("#screen-host-buzzin")?.classList.toggle("has-image", !!url);
  setQuestionImage(
    $("#host-buzzin-question-image"),
    $("#host-buzzin-question-image-wrap"),
    url
  );
}

function updateHostBuzzinAdvanceButtons(hasNext) {
  hostBuzzinHasNextQuestion = Boolean(hasNext);
  const label = hasNext ? uiT("quiz.nextQuestion") : uiT("common.next");
  ["btn-host-buzzin-feedback-done", "btn-host-buzzin-empty-done"].forEach((id) => {
    const btn = document.getElementById(id);
    const span = btn?.querySelector("span");
    if (span) span.textContent = label;
  });
}

function hostBuzzinCanAdvanceQuestion() {
  return hostBuzzinHasNextQuestion && Boolean(hostBuzzinRoomId) && !hostBuzzinAdvancingQuestion;
}

async function hostBuzzinAdvanceQuestion() {
  if (!hostBuzzinCanAdvanceQuestion()) {
    throw new Error("No more Buzz In questions.");
  }

  const socket = getHostSessionSocket();
  hostBuzzinAdvancingQuestion = true;
  resetHostBuzzinFeedbackAnim();
  hostBuzzinPlayedSpokenFeedbackAudio.clear();
  hostBuzzinLastResponses = [];
  hostBuzzinActiveScreenPhase = null;
  hostBuzzinLuckyStar = null;
  hostBuzzinTopicSpeaking = true;
  hideHostBuzzinJoinTimer();
  setHostBuzzinStartButtonVisible(false);
  setHostBuzzinPrompt(uiT("buzzin.promptReady"));
  showHostBuzzinScreenForPhase("join", { force: true });

  const joinStatus = $("#host-buzzin-join-status");
  if (joinStatus) joinStatus.textContent = uiT("buzzin.uncleReading");

  try {
    if (!socket.connected) {
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", () => reject(new Error("Could not connect to room.")));
        socket.connect(hostBuzzinRoomId);
      });
    }

    const res = await new Promise((resolve, reject) => {
      socket.emit("next_buzzin_question", { roomId: hostBuzzinRoomId }, (response) => {
        if (!response?.ok) {
          reject(new Error(response?.error || "Could not open next question."));
          return;
        }
        resolve(response);
      });
    });

    if (res.roundId != null) hostBuzzinRoundId = res.roundId;
    updateHostBuzzinUi(res);
    if (joinStatus) joinStatus.textContent = uiT("buzzin.uncleReading");
    setHostBuzzinStartButtonVisible(false);

    try {
      if (res.topicAudio) {
        await playHostUncleTommyTts(res.topicAudio, res.topicAudioFormat || "mp3");
      }
    } catch (err) {
      console.warn(err?.message || "Could not play buzz-in topic TTS.");
    } finally {
      hostBuzzinTopicSpeaking = false;
      if ((res.phase || "ready") === "ready") {
        setHostBuzzinStartButtonVisible(true);
        if (joinStatus) joinStatus.textContent = uiT("buzzin.tapGetReady");
      }
    }
  } finally {
    hostBuzzinAdvancingQuestion = false;
  }
}

function hostBuzzinShowFeedbackPhase(payload) {
  const phase = payload?.phase || "join";
  if (phase === "ready" || phase === "join") return false;
  return true;
}

function hostBuzzinHasBuzzes(payload) {
  return Boolean((payload?.buzzes || []).length || hostBuzzinLuckyStar);
}

function hostBuzzinShowEmptyPhase(payload) {
  if (!hostBuzzinShowFeedbackPhase(payload)) return false;
  return !hostBuzzinHasBuzzes(payload);
}

function hostBuzzinScreenPhase(payload) {
  if (!hostBuzzinShowFeedbackPhase(payload)) return "join";
  return hostBuzzinShowEmptyPhase(payload) ? "empty" : "feedback";
}

function showHostBuzzinScreenForPhase(phase, { force = false } = {}) {
  const normalized =
    phase === "join" ? "join" : phase === "empty" ? "empty" : "feedback";
  const screenId =
    normalized === "join"
      ? "host-buzzin"
      : normalized === "empty"
        ? "host-buzzin-empty"
        : "host-buzzin-feedback";
  const domActive = document.querySelector(`#screen-${screenId}.active`);
  if (!force && hostBuzzinActiveScreenPhase === normalized && domActive) return;
  hostBuzzinActiveScreenPhase = normalized;
  if (typeof showScreen !== "function") return;
  showScreen(screenId, { transition: false });
  if (normalized === "feedback") triggerHostBuzzinFeedbackEnter();
  if (normalized === "empty") triggerHostBuzzinEmptyEnter();
}

function triggerHostBuzzinFeedbackEnter() {
  const screen = $("#screen-host-buzzin-feedback");
  if (!screen) return;
  screen.classList.remove("host-buzzin-feedback-screen--enter");
  void screen.offsetWidth;
  screen.classList.add("host-buzzin-feedback-screen--enter");
  window.LangoGsap?.playBuzzinFeedbackEnter?.(screen);
}

function triggerHostBuzzinEmptyEnter() {
  const screen = $("#screen-host-buzzin-empty");
  if (!screen) return;
  screen.classList.remove("host-buzzin-empty-screen--enter");
  void screen.offsetWidth;
  screen.classList.add("host-buzzin-empty-screen--enter");
  window.LangoGsap?.playBuzzinEmptyEnter?.(screen);
}

function stopHostBuzzinJoinTimer() {
  if (hostBuzzinJoinTimer) {
    clearInterval(hostBuzzinJoinTimer);
    hostBuzzinJoinTimer = null;
  }
}

/** Buzz window: the last 5 seconds get a pulse on each tick. */
const HOST_BUZZIN_URGENT_SECONDS = 5;

function startHostBuzzinJoinTimer(joinEndsAt, joinSeconds) {
  stopHostBuzzinJoinTimer();
  const wrap = $("#host-buzzin-timer-wrap");
  const valueEl = $("#host-buzzin-timer");
  if (!wrap || !valueEl || !joinEndsAt) {
    if (wrap) wrap.hidden = true;
    return;
  }

  const motion = window.LangoGsap;
  let shown = null;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((serverTimeToLocal(joinEndsAt) - Date.now()) / 1000));
    if (remaining !== shown) {
      const first = shown === null;
      shown = remaining;
      valueEl.textContent = String(remaining);
      if (!first) {
        motion?.playCountdownTick?.(valueEl, {
          urgent: remaining > 0 && remaining <= HOST_BUZZIN_URGENT_SECONDS,
        });
      }
    }
    if (remaining <= 0) stopHostBuzzinJoinTimer();
  };

  if (wrap.hidden) {
    wrap.hidden = false;
    fitHostBuzzinQuestion();
  }
  const totalMs = (Number(joinSeconds) || 20) * 1000;
  motion?.startCountdownRing?.(wrap, { endsAt: serverTimeToLocal(joinEndsAt), totalMs });
  tick();
  hostBuzzinJoinTimer = setInterval(tick, 250);
}

function hideHostBuzzinJoinTimer() {
  stopHostBuzzinJoinTimer();
  const wrap = $("#host-buzzin-timer-wrap");
  window.LangoGsap?.stopCountdownRing?.(wrap);
  if (wrap && !wrap.hidden) {
    wrap.hidden = true;
    fitHostBuzzinQuestion();
  }
}

/**
 * Random / Next question wait in the Real Time panel until the answer is over:
 * the student has recorded, the analysis is back, and Uncle Tommy has finished
 * replaying it and speaking the feedback (no retry in progress).
 */
function hostBuzzinAnswerFlowComplete(payload) {
  if (!payload || !hostBuzzinShowFeedbackPhase(payload) || hostBuzzinShowEmptyPhase(payload)) return false;
  if (hostBuzzinLuckyDrawRunning) return false;
  if (payload.retryActivePlayerId || payload.pendingRetryPlayerId) return false;
  if (!buzzinSelectedStudent(payload)) return true;
  const responses = buzzinResponsesForDisplay(payload);
  const latest = responses.length ? responses[responses.length - 1] : null;
  if (!latest) return Boolean(payload.typingComplete);
  if (latest.analysisStatus === "error") return true;
  if (latest.analysisStatus !== "done") return false;
  if (!latest.text) return true;
  return hostBuzzinReviewSequenceDone.has(buzzinSpokenFeedbackAudioKey(latest));
}

function hostBuzzinRetryChoiceReady(payload) {
  const pendingId = payload?.pendingRetryPlayerId;
  if (!pendingId || payload.phase !== "typing" || hostBuzzinLuckyDrawRunning) return false;
  const responses = buzzinResponsesForDisplay(payload);
  const latest = responses.length ? responses[responses.length - 1] : null;
  if (!latest || latest.playerId !== pendingId) return false;
  if (latest.analysisStatus === "error") return true;
  if (latest.analysisStatus !== "done") return false;
  return !latest.text || hostBuzzinReviewSequenceDone.has(buzzinSpokenFeedbackAudioKey(latest));
}

function syncHostBuzzinNextActions(payload) {
  const row = $("#host-buzzin-feedback-next-actions");
  if (row) row.hidden = !hostBuzzinAnswerFlowComplete(payload);

  // Teacher decides whether the marked student answers again.
  const retryRow = $("#host-buzzin-feedback-retry-actions");
  if (!retryRow) return;
  const ready = hostBuzzinRetryChoiceReady(payload);
  retryRow.hidden = !ready;
  if (!ready) return;
  const name =
    (payload.buzzes || []).find((b) => b.playerId === payload.pendingRetryPlayerId)?.displayName || "Student";
  const label = $("#btn-host-buzzin-retry-label");
  if (label) label.textContent = uiT("buzzin.hostRetry", { name });
  ["#btn-host-buzzin-retry", "#btn-host-buzzin-skip-retry"].forEach((sel) => {
    const btn = $(sel);
    if (btn) btn.disabled = false;
  });
}

function emitHostBuzzinRetryChoice(accept) {
  const socket = getHostSessionSocket();
  const buttons = ["#btn-host-buzzin-retry", "#btn-host-buzzin-skip-retry"].map((sel) => $(sel));
  buttons.forEach((btn) => {
    if (btn) btn.disabled = true;
  });
  socket.emit("buzzin_retry_choice", { roomId: hostBuzzinRoomId, accept }, (res) => {
    if (!res?.ok) {
      buttons.forEach((btn) => {
        if (btn) btn.disabled = false;
      });
      console.warn(res?.error || "Could not send retry choice.");
      return;
    }
    updateHostBuzzinUi(res);
  });
}

function syncHostBuzzinShowAnswerButton(payload) {
  const btn = $("#btn-host-buzzin-show-answer");
  if (!btn) return;
  const phase = payload?.phase || "";
  const hasStudent = Boolean(buzzinSelectedStudent(payload));
  const showPanel = hostBuzzinShowFeedbackPhase(payload) && !hostBuzzinShowEmptyPhase(payload);
  const visible = showPanel && hasStudent && (phase === "typing" || phase === "done");
  btn.hidden = !visible;
  btn.disabled = hostBuzzinCorrectAnswerRevealed;
  btn.setAttribute("aria-pressed", hostBuzzinCorrectAnswerRevealed ? "true" : "false");
}

function getHostBuzzinCorrectAnswerForReveal(payload = hostBuzzinLastPayload) {
  return resolveHostBuzzinCorrectAnswer(payload, hostBuzzinActiveExercise);
}

function revealHostBuzzinCorrectAnswer() {
  if (hostBuzzinCorrectAnswerRevealed || !hostBuzzinLastPayload) return;
  hostBuzzinCorrectAnswerRevealed = true;
  hostBuzzinAnswerKeyJustRevealed = true;
  syncHostBuzzinShowAnswerButton(hostBuzzinLastPayload);
  updateHostBuzzinTurnUi(hostBuzzinLastPayload);
  hostBuzzinAnswerKeyJustRevealed = false;
}

function updateHostBuzzinTurnUi(payload) {
  hostBuzzinLastPayload = payload;
  syncHostBuzzinShowAnswerButton(payload);
  syncHostBuzzinNextActions(payload);
  const turnStatus = $("#host-buzzin-turn-status");
  const chatEl = $("#host-buzzin-feedback-chat");
  const winnerEl = $("#host-buzzin-winner-card");
  if (!chatEl || !winnerEl) return;

  hostBuzzinLastResponses = buzzinResponsesForDisplay(payload);
  setupBuzzinSpokenFeedbackPlayDelegation(chatEl, () => hostBuzzinLastResponses);

  if (!hostBuzzinShowFeedbackPhase(payload)) {
    return;
  }

  if (hostBuzzinShowEmptyPhase(payload)) {
    return;
  }

  hideHostBuzzinJoinTimer();

  const selectedStudent = buzzinSelectedStudent(payload);
  const currentTurn = buzzinCurrentTurnForDisplay(payload);
  const responses = buzzinResponsesForDisplay(payload);
  const latestResponse = responses.length ? responses[responses.length - 1] : null;
  let response = latestResponse;
  let chatStudent = selectedStudent;
  let chatCurrentTurn = currentTurn;
  let chatPendingTurn =
    chatCurrentTurn &&
    (!responses.length || payload?.retryActivePlayerId === chatCurrentTurn.playerId)
      ? chatCurrentTurn
      : null;

  if (
    hostBuzzinLuckyStar &&
    currentTurn?.playerId === hostBuzzinLuckyStar.playerId
  ) {
    chatStudent = hostBuzzinLuckyStar;
    chatCurrentTurn = currentTurn;
    chatPendingTurn = null;
    response =
      responses.find((entry) => entry.playerId === hostBuzzinLuckyStar.playerId) ||
      latestResponse;
  }

  const isLive = Boolean((chatPendingTurn || chatCurrentTurn) && !payload.typingComplete);
  const animate = hostBuzzinFeedbackAnimateFlags(
    payload,
    chatStudent,
    chatPendingTurn || chatCurrentTurn,
    responses
  );
  const responseKey = latestResponse ? buzzinSpokenFeedbackAudioKey(latestResponse) : "";
  const feedbackVisible =
    !latestResponse ||
    latestResponse.analysisStatus === "pending" ||
    latestResponse.analysisStatus === "error" ||
    hostBuzzinFeedbackVisible.has(responseKey);

  if (!selectedStudent) {
    if (turnStatus) turnStatus.textContent = uiT("buzzin.noOneBuzzed");
    if (!hostBuzzinLuckyStar) {
      setHostBuzzinLeaderboardMode("winner");
      renderHostBuzzinWinnerCard(winnerEl, null, payload);
    }
    renderHostBuzzinFeedbackChat(chatEl, {
      topic: payload.topic,
      emptyText: uiT("buzzin.noAnswerYet"),
    });
    return;
  }

  if (payload.typingComplete) {
    if (turnStatus) turnStatus.textContent = uiT("buzzin.hasAnswered", { name: chatStudent?.displayName || selectedStudent?.displayName || "Student" });
  } else if (payload.pendingRetryPlayerId && payload.pendingRetryPlayerId === (chatStudent || selectedStudent)?.playerId) {
    if (turnStatus) {
      turnStatus.textContent = uiT("buzzin.waitingRetryChoice", {
        name: (chatStudent || selectedStudent)?.displayName || "Student",
      });
    }
  } else if (payload.retryActivePlayerId) {
    if (turnStatus) {
      turnStatus.textContent = uiT("buzzin.retryRecording", {
        name: (chatStudent || selectedStudent)?.displayName || "Student",
      });
    }
  } else if (chatCurrentTurn) {
    if (turnStatus) turnStatus.textContent = uiT("buzzin.waitingRecord", { name: chatCurrentTurn.displayName });
  } else {
    if (turnStatus) turnStatus.textContent = uiT("buzzin.waitingToAnswer", { name: (chatStudent || selectedStudent)?.displayName || "Student" });
  }

  if (!hostBuzzinLuckyStar) {
    setHostBuzzinLeaderboardMode("winner");
    renderHostBuzzinWinnerCard(winnerEl, selectedStudent, payload, {
      isLive,
      animate: animate.winner,
    });
  }

  const retryStudentName = (chatStudent || selectedStudent)?.displayName || "Student";
  const retryNotice = payload.retryActivePlayerId
    ? uiT("buzzin.retryNotice", { name: retryStudentName })
    : payload.pendingRetryPlayerId
      ? uiT("buzzin.waitingRetryChoice", { name: retryStudentName })
      : "";

  const renderBuzzinChat = (overrides = {}) => {
    renderHostBuzzinFeedbackChat(chatEl, {
      topic: payload.topic,
      student: chatStudent,
      responses,
      currentTurn: chatPendingTurn ? null : chatCurrentTurn,
      pendingTurn: chatPendingTurn,
      emptyText: uiT("buzzin.waitingAnswer"),
      feedbackVisible,
      correctAnswer: getHostBuzzinCorrectAnswerForReveal(payload),
      correctAnswerRevealed: hostBuzzinCorrectAnswerRevealed,
      retryNotice,
      animate: {
        topic: animate.topic,
        answer: animate.answer,
        feedback: animate.feedback,
        answerKey: overrides.answerKey ?? hostBuzzinAnswerKeyJustRevealed,
      },
      ...overrides,
    });
  };

  renderBuzzinChat();

  if (
    latestResponse?.analysisStatus === "done" &&
    latestResponse.text &&
    !hostBuzzinReviewSequencePlayed.has(responseKey)
  ) {
    hostBuzzinReviewSequencePlayed.add(responseKey);
    enqueueHostUncleTommySpeech(() =>
      playBuzzinHostAnswerReviewSequence(latestResponse, {
        onFeedbackReady: () => {
          hostBuzzinFeedbackVisible.add(responseKey);
          renderBuzzinChat({ feedbackVisible: true, animate: { feedback: true } });
        },
      })
    ).then(() => {
      hostBuzzinReviewSequenceDone.add(responseKey);
      syncHostBuzzinNextActions(hostBuzzinLastPayload);
    });
  }
}

function setHostBuzzinPrompt(text) {
  const prompt = document.querySelector("#screen-host-buzzin .host-buzzin-prompt");
  if (prompt) prompt.textContent = text;
}

function setHostBuzzinStartButtonVisible(visible) {
  const startBtn = $("#btn-host-buzzin-start");
  if (!startBtn) return;
  startBtn.hidden = false;
  const canEnable = visible && !hostBuzzinTopicSpeaking;
  startBtn.disabled = !canEnable;
  startBtn.classList.toggle("is-ready", canEnable);
}

function updateHostBuzzinUi(payload) {
  const phase = payload.phase || "join";
  const showFeedback = hostBuzzinShowFeedbackPhase(payload);
  if (payload.topic || payload.totalQuestions != null || payload.questionIndex != null) {
    syncHostBuzzinTopic(payload.topic, payload);
    if (Object.prototype.hasOwnProperty.call(payload, "image")) {
      syncHostBuzzinQuestionImage(payload.image);
    }
  } else {
    updateHostBuzzinAdvanceButtons(Boolean(payload.hasNextQuestion));
  }

  const joinStatus = $("#host-buzzin-join-status");

  if (phase === "ready") {
    hideHostBuzzinJoinTimer();
    setHostBuzzinStartButtonVisible(true);
    setHostBuzzinPrompt(uiT("buzzin.promptReady"));
    if (joinStatus) {
      joinStatus.textContent = hostBuzzinTopicSpeaking
        ? uiT("buzzin.uncleReading")
        : uiT("buzzin.tapGetReady");
    }
    showHostBuzzinScreenForPhase("join", { force: true });
    updateHostBuzzinTurnUi(payload);
    return;
  }

  hostBuzzinTopicSpeaking = false;
  setHostBuzzinStartButtonVisible(false);

  if (joinStatus) {
    joinStatus.textContent = showFeedback
      ? ""
      : uiT("buzzin.joinCountdown", { n: payload.joinSecondsRemaining ?? 20 });
  }

  if (showFeedback) {
    hideHostBuzzinJoinTimer();
    setHostBuzzinPrompt(uiT("buzzin.promptNow"));
    showHostBuzzinScreenForPhase(hostBuzzinScreenPhase(payload));
  } else {
    setHostBuzzinPrompt(uiT("buzzin.promptNow"));
    noteServerClock(payload.serverNow);
    startHostBuzzinJoinTimer(payload.joinEndsAt, payload.joinSeconds);
    showHostBuzzinScreenForPhase("join");
  }
  updateHostBuzzinTurnUi(payload);
}

function setHostBuzzinLeaderboardMode(mode = "winner") {
  const title = $("#host-buzzin-leaderboard-title");
  const sub = $("#host-buzzin-leaderboard-sub");
  if (!title || !sub) return;

  if (mode === "lucky") {
    title.textContent = uiT("buzzin.luckyStudents");
    sub.textContent = uiT("buzzin.luckyStar");
    return;
  }

  title.textContent = uiT("buzzin.fastest");
  sub.textContent = uiT("buzzin.winnerSub");
}

function applyHostBuzzinLuckyStar(winner, { animate = true } = {}) {
  if (!winner) return;
  hostBuzzinLuckyStar = winner;
  setHostBuzzinLeaderboardMode("lucky");
  renderHostBuzzinLuckyStarCard($("#host-buzzin-winner-card"), winner, { animate });
}

function waitHostBuzzin(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stopHostBuzzinLuckyDrawScramble() {
  if (hostBuzzinLuckyDrawScramble) {
    window.clearInterval(hostBuzzinLuckyDrawScramble);
    hostBuzzinLuckyDrawScramble = 0;
  }
}

function getHostBuzzinLuckyDrawNamePool() {
  const names = getHostBuzzinLuckyDrawCandidates()
    .map((entry) => entry.displayName)
    .filter(Boolean);
  if (names.length < 2 && new URLSearchParams(window.location.search).has("preview")) {
    names.push("Sophia Patel", "Liam Chen", "Ava Williams", "Emma Smith", "Noah Brown");
  }
  return names.length < 2 ? [] : names;
}

function startHostBuzzinLuckyDrawScramble(nameEl) {
  stopHostBuzzinLuckyDrawScramble();
  if (!nameEl) return;

  const names = getHostBuzzinLuckyDrawNamePool();
  nameEl.setAttribute("aria-live", "off");
  if (!names.length) {
    nameEl.textContent = "???";
    return;
  }

  nameEl.textContent = names[Math.floor(Math.random() * names.length)];
  hostBuzzinLuckyDrawScramble = window.setInterval(() => {
    nameEl.textContent = names[Math.floor(Math.random() * names.length)];
  }, 70);
}

function resetHostBuzzinLuckyDrawUi() {
  const modal = $("#host-buzzin-lucky-draw");
  const wheel = $("#host-buzzin-lucky-draw-wheel");
  const avatar = $("#host-buzzin-lucky-draw-avatar");
  const nameEl = $("#host-buzzin-lucky-draw-name");

  stopHostBuzzinLuckyDrawScramble();
  window.LangoGsap?.stopLuckyDrawSpin?.(wheel);
  if (modal) {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("is-spinning", "is-revealed");
  }
  if (wheel) wheel.classList.remove("is-spinning", "is-revealed");
  if (avatar) avatar.innerHTML = "";
  if (nameEl) {
    nameEl.textContent = "???";
    nameEl.setAttribute("aria-live", "polite");
  }
}

function getHostBuzzinLuckyDrawPreviewWinner() {
  return { playerId: "preview-kiki", displayName: "Kiki Cheung" };
}

function getHostBuzzinLuckyDrawCandidates() {
  const participants =
    typeof getHostSessionParticipants === "function" ? getHostSessionParticipants() : [];

  return participants
    .map((participant) => ({
      playerId: participant.userId || participant.id || "",
      displayName:
        participant.displayName ||
        participant.name ||
        participant.nickname ||
        "Student",
    }))
    .filter((entry) => entry.playerId && entry.displayName);
}

function requestHostBuzzinLuckyDrawWinner() {
  if (new URLSearchParams(window.location.search).has("preview")) {
    const winner = getHostBuzzinLuckyDrawPreviewWinner();
    const topic = getHostBuzzinTopicText();
    return Promise.resolve({
      winner,
      topic,
      announcementText: buildBuzzinAnswerAnnouncement(topic, winner.displayName),
      announcementAudio: null,
      announcementAudioFormat: null,
    });
  }

  const candidates = getHostBuzzinLuckyDrawCandidates();
  if (!hostBuzzinRoomId) {
    const winner =
      candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : getHostBuzzinLuckyDrawPreviewWinner();
    const topic = getHostBuzzinTopicText();
    return Promise.resolve({
      winner,
      topic,
      announcementText: buildBuzzinAnswerAnnouncement(topic, winner.displayName),
      announcementAudio: null,
      announcementAudioFormat: null,
    });
  }

  const socket = getHostSessionSocket();
  return new Promise((resolve, reject) => {
    const run = () => {
      socket.emit("buzzin_lucky_draw", { roomId: hostBuzzinRoomId }, (res) => {
        if (!res?.ok) {
          reject(new Error(res?.error || "Could not run lucky draw."));
          return;
        }
        resolve({
          winner: {
            playerId: res.winner?.playerId || "",
            displayName: res.winner?.displayName || "Student",
          },
          topic: res.topic || getHostBuzzinTopicText(),
          announcementText: res.announcementText || "",
          announcementAudio: res.announcementAudio || null,
          announcementAudioFormat: res.announcementAudioFormat || "mp3",
          payload: res,
        });
      });
    };

    if (socket.connected) run();
    else {
      socket.once("connect", run);
      socket.connect(hostBuzzinRoomId);
    }
  });
}

let hostBuzzinSpeechQueue = Promise.resolve();

function enqueueHostUncleTommySpeech(task) {
  hostBuzzinSpeechQueue = hostBuzzinSpeechQueue.then(async () => {
    try {
      await task();
    } catch (err) {
      console.warn(err?.message || err);
    }
  });
  return hostBuzzinSpeechQueue;
}

function buzzinAnswerAnnouncementKey(payload) {
  const announcement = payload?.answerAnnouncement;
  if (!announcement?.playerId) return "";
  return `${payload.roundId || 0}:${announcement.playerId}`;
}

function buzzinStudentAlreadyAnswered(payload, playerId) {
  if (!playerId) return false;
  return (payload?.responses || []).some(
    (entry) => entry.playerId === playerId && String(entry.text || "").trim()
  );
}

async function playHostBuzzinAnswerAnnouncement({ winner, announcementAudio, announcementAudioFormat } = {}) {
  const turnStatus = $("#host-buzzin-turn-status");
  const winnerName = winner?.displayName || "Student";
  if (turnStatus) {
    turnStatus.textContent = uiT("buzzin.callingOn", { name: winnerName });
  }

  hostBuzzinTopicSpeaking = true;
  try {
    if (announcementAudio) {
      await playHostUncleTommyTts(announcementAudio, announcementAudioFormat || "mp3");
    }
  } catch (err) {
    console.warn(err?.message || "Could not play answer announcement.");
  } finally {
    hostBuzzinTopicSpeaking = false;
    if (turnStatus) {
      turnStatus.textContent = uiT("buzzin.waitingRecord", { name: winnerName });
    }
  }
}

async function maybePlayHostBuzzinAnswerAnnouncement(payload) {
  const announcement = payload?.answerAnnouncement;
  if (!announcement) return;

  const key = buzzinAnswerAnnouncementKey(payload);
  if (!key) return;
  if (hostBuzzinPlayedAnnouncements.has(key)) return;
  if (buzzinStudentAlreadyAnswered(payload, announcement.playerId)) {
    hostBuzzinPlayedAnnouncements.add(key);
    return;
  }
  if (!announcement.audio) return;
  hostBuzzinPlayedAnnouncements.add(key);

  await enqueueHostUncleTommySpeech(() =>
    playHostBuzzinAnswerAnnouncement({
      winner: {
        playerId: announcement.playerId,
        displayName: announcement.displayName,
      },
      announcementAudio: announcement.audio,
      announcementAudioFormat: announcement.format,
    })
  );
}

// Spins as soon as it is called; the winner may still be on its way from the
// server (the ack waits on the announcement TTS), so the reveal waits on both.
async function playHostBuzzinLuckyDraw(drawPromise) {
  const modal = $("#host-buzzin-lucky-draw");
  const wheel = $("#host-buzzin-lucky-draw-wheel");
  const avatar = $("#host-buzzin-lucky-draw-avatar");
  const nameEl = $("#host-buzzin-lucky-draw-name");
  if (!modal || !wheel || !avatar || !nameEl) return drawPromise;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const spinMs = reduceMotion ? 0 : 1600;
  const revealHoldMs = reduceMotion ? 600 : 1600;
  const motion = window.LangoGsap;
  const pointer = modal.querySelector(".host-buzzin-lucky-draw__pointer");

  resetHostBuzzinLuckyDrawUi();
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  modal.classList.add("is-spinning");
  // GSAP drives the wheel so it can slow to a stop; the CSS spin is the fallback.
  const gsapSpin = motion?.startLuckyDrawSpin?.(wheel);
  if (!gsapSpin) wheel.classList.add("is-spinning");
  startHostBuzzinLuckyDrawScramble(nameEl);

  const [result] = await Promise.all([drawPromise, spinMs > 0 ? waitHostBuzzin(spinMs) : null]);
  const winner = result?.winner;
  if (!winner) {
    stopHostBuzzinLuckyDrawScramble();
    resetHostBuzzinLuckyDrawUi();
    return null;
  }

  stopHostBuzzinLuckyDrawScramble();
  if (gsapSpin) {
    // The wheel slows down and the name changes once per segment passing the pointer.
    const pool = getHostBuzzinLuckyDrawNamePool();
    await motion.settleLuckyDrawSpin(wheel, {
      pointer,
      onTick: () => {
        if (pool.length) nameEl.textContent = pool[Math.floor(Math.random() * pool.length)];
      },
    });
  }
  modal.classList.remove("is-spinning");
  modal.classList.add("is-revealed");
  wheel.classList.remove("is-spinning");
  wheel.classList.add("is-revealed");
  avatar.innerHTML = buzzinLuckyDrawAvatarHtml(winner.displayName);
  nameEl.setAttribute("aria-live", "polite");
  nameEl.textContent = winner.displayName;
  motion?.playLuckyDrawReveal?.(wheel, pointer);

  await waitHostBuzzin(revealHoldMs);

  resetHostBuzzinLuckyDrawUi();
  return result;
}

async function openHostBuzzinLuckyDraw() {
  if (hostBuzzinLuckyDrawRunning) return;
  hostBuzzinLuckyDrawRunning = true;
  syncHostBuzzinNextActions(hostBuzzinLastPayload);

  const randomBtns = getHostBuzzinRandomButtons();
  randomBtns.forEach((btn) => {
    btn.disabled = true;
  });

  try {
    const result = await playHostBuzzinLuckyDraw(requestHostBuzzinLuckyDrawWinner());
    const winner = result?.winner;
    if (!winner) return;

    applyHostBuzzinLuckyStar(winner);

    if (result?.payload) {
      if (result.payload.roundId != null) hostBuzzinRoundId = result.payload.roundId;
      updateHostBuzzinUi(result.payload);
      await maybePlayHostBuzzinAnswerAnnouncement(result.payload);
    }
  } catch (err) {
    console.warn(err?.message || "Could not run lucky draw.");
    resetHostBuzzinLuckyDrawUi();
  } finally {
    hostBuzzinLuckyDrawRunning = false;
    getHostBuzzinRandomButtons().forEach((btn) => {
      btn.disabled = false;
    });
    syncHostBuzzinNextActions(hostBuzzinLastPayload);
  }
}

function getHostBuzzinRandomButtons() {
  return [
    $("#btn-host-buzzin-random"),
    $("#btn-host-buzzin-empty-random"),
  ].filter(Boolean);
}

function bindHostBuzzinSocketHandlers(socket) {
  if (socket.__hostBuzzinBound) return;
  socket.__hostBuzzinBound = true;

  const applyBuzzinPayload = (payload) => {
    if (payload?.roundId != null) hostBuzzinRoundId = payload.roundId;
    if (payload?.phase === "ready") {
      resetHostBuzzinFeedbackAnim();
      hostBuzzinPlayedSpokenFeedbackAudio.clear();
      hostBuzzinLastResponses = [];
      hostBuzzinLuckyStar = null;
    }
    void maybePlayHostBuzzinAnswerAnnouncement(payload);
    updateHostBuzzinUi(payload);
  };

  socket.on("buzzin_round_started", applyBuzzinPayload);
  socket.on("buzzin_join_opened", applyBuzzinPayload);
  socket.on("buzzin_update", applyBuzzinPayload);
  socket.on("buzzin_join_closed", applyBuzzinPayload);
  socket.on("buzzin_response_analyzed", applyBuzzinPayload);
}

function ensureHostBuzzinSocket() {
  const socket = getHostSessionSocket();
  bindHostBuzzinSocketHandlers(socket);

  if (hostBuzzinUiReady) return;
  hostBuzzinUiReady = true;

  $("#btn-host-buzzin-show-answer")?.addEventListener("click", () => {
    revealHostBuzzinCorrectAnswer();
  });
  $("#btn-host-buzzin-retry")?.addEventListener("click", () => emitHostBuzzinRetryChoice(true));
  $("#btn-host-buzzin-skip-retry")?.addEventListener("click", () => emitHostBuzzinRetryChoice(false));
}

function startHostBuzzinRound(roomId) {
  if (!roomId) return Promise.resolve();
  hostBuzzinRoomId = roomId;
  hostBuzzinRoundId = null;
  hostBuzzinPlayedSpokenFeedbackAudio.clear();
  hostBuzzinLastResponses = [];
  hostBuzzinActiveScreenPhase = null;
  hostBuzzinLuckyStar = null;
  hostBuzzinPlayedAnnouncements.clear();
  setHostBuzzinLeaderboardMode("winner");
  hostBuzzinTopicSpeaking = true;
  resetHostBuzzinFeedbackAnim();
  ensureHostBuzzinSocket();
  hideHostBuzzinJoinTimer();
  setHostBuzzinStartButtonVisible(false);
  setHostBuzzinPrompt(uiT("buzzin.promptReady"));
  showHostBuzzinScreenForPhase("join", { force: true });

  const joinStatus = $("#host-buzzin-join-status");
  if (joinStatus) joinStatus.textContent = uiT("buzzin.uncleReading");

  const socket = getHostSessionSocket();

  return new Promise((resolve, reject) => {
    const run = async () => {
      if (typeof connectHostSession === "function") {
        try {
          await connectHostSession(roomId);
        } catch (err) {
          hostBuzzinTopicSpeaking = false;
          reject(err);
          return;
        }
      }

      socket.emit("start_buzzin_round", { roomId }, (res) => {
        void (async () => {
          if (!res?.ok) {
            hostBuzzinTopicSpeaking = false;
            reject(new Error(res?.error || "Could not prepare buzz-in round."));
            return;
          }
          updateHostBuzzinUi(res);
          if (joinStatus) joinStatus.textContent = uiT("buzzin.uncleReading");
          setHostBuzzinStartButtonVisible(false);

          try {
            if (res.topicAudio) {
              await playHostUncleTommyTts(res.topicAudio, res.topicAudioFormat || "mp3");
            }
          } catch (err) {
            console.warn(err?.message || "Could not play buzz-in topic TTS.");
          } finally {
            hostBuzzinTopicSpeaking = false;
            if ((res.phase || "ready") === "ready") {
              setHostBuzzinStartButtonVisible(true);
              if (joinStatus) joinStatus.textContent = uiT("buzzin.tapGetReady");
            }
          }
          resolve();
        })();
      });
    };

    if (socket.connected) void run();
    else {
      socket.once("connect", () => void run());
      socket.connect(roomId);
    }
  });
}

async function openHostBuzzinJoin() {
  if (!hostBuzzinRoomId) return;

  const socket = getHostSessionSocket();
  const startBtn = $("#btn-host-buzzin-start");
  const joinStatus = $("#host-buzzin-join-status");
  const screen = $("#screen-host-buzzin");
  if (startBtn) startBtn.disabled = true;
  if (joinStatus) joinStatus.textContent = uiT("buzzin.openJoin");

  if (!socket.connected) {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", () => reject(new Error("Could not connect to room.")));
      socket.connect(hostBuzzinRoomId);
    });
  }

  const emitOpenJoin = () =>
    new Promise((resolve, reject) => {
      socket.emit("open_buzzin_join", { roomId: hostBuzzinRoomId }, (res) => {
        if (!res?.ok) {
          if (startBtn) {
            startBtn.disabled = false;
            startBtn.classList.add("is-ready");
          }
          if (joinStatus) joinStatus.textContent = res?.error || "Could not start buzz in.";
          reject(new Error(res?.error || "Could not start buzz in."));
          return;
        }
        updateHostBuzzinUi(res);
        resolve(res);
      });
    });

  if (typeof window.LangoGsap?.playBuzzinStartEffect === "function" && screen) {
    await window.LangoGsap.playBuzzinStartEffect(screen, {
      onBurst: emitOpenJoin,
    });
    return;
  }

  await emitOpenJoin();
}

function getRoomQuizSocket() {
  if (!roomQuizSocket) {
    roomQuizSocket = io({ transports: ["websocket", "polling"] });
    setupHostRoomQuizSocket(roomQuizSocket);
  }
  return roomQuizSocket;
}

function renderHostQuizPreview(data, { transition = true } = {}) {
  roomQuizCurrentQuestion = data;
  clearTimer();
  const activeBefore = document.querySelector(".screen.active")?.id || null;
  const showPromise = showScreen("host-quiz-preview", { transition });

  const points = data.points || 300;
  const previewScreen = $("#screen-host-quiz-preview");
  const questionImageUrl = resolvedMediaUrl(data.image);
  previewScreen?.classList.toggle("has-image", !!questionImageUrl);
  $("#host-quiz-preview-title").textContent = uiT("mcq.questionN", { n: data.questionIndex + 1 });
  $("#host-quiz-preview-points").textContent = uiT("mcq.pts", { n: points });
  $("#host-quiz-preview-question-text").textContent = data.text || "";
  fitTextToBoxSoon({ max: 64 }, $("#host-quiz-preview-question-text"));
  setQuestionImage(
    $("#host-quiz-preview-image"),
    $("#host-quiz-preview-image-wrap"),
    questionImageUrl
  );

  const previewSeconds = data.previewSeconds || 5;
  const previewScreenEl = $("#screen-host-quiz-preview");
  previewScreenEl?.classList.add("is-read-phase");
  const fillEl = $("#host-quiz-preview-progress");
  // While Uncle Tommy reads there is no deadline: answers open when he finishes.
  if (data.speaking) {
    resetMcqReadProgress(fillEl);
    return;
  }
  const startPreviewBar = (phase) => {
    animateMcqReadProgress(fillEl, data.previewEndsAt, previewSeconds, { drain: true });
  };
  Promise.resolve(showPromise).then(() => {
    requestAnimationFrame(() => startPreviewBar("after-showScreen"));
  });

  startDeadlineTimer(
    data.previewEndsAt,
    previewSeconds,
    (remaining) => {
      /* Host preview uses the bar under the question; keep countdown off-screen. */
    }
  );
}

function renderHostQuizSpeaking(data) {
  roomQuizFastMode = !!data.fastMode;
  if (data.fastMode) {
    renderHostQuizQuestion(data, { preparing: true, transition: true });
    clearTimer();
    $("#host-quiz-countdown").textContent = "…";
    window.LangoGsap?.resetCountdownRing?.($("#host-quiz-countdown")?.closest(".host-mcq-countdown"));
    $("#host-quiz-answered-count").textContent = uiT("buzzin.uncleReading");
    return;
  }
  renderHostQuizPreview({ ...data, speaking: true });
}

async function playHostUncleTommyTts(audioContent, format) {
  if (!audioContent || typeof playUncleTommyTts !== "function") return;
  await playUncleTommyTts(audioContent, format || "mp3");
}

async function playHostQuestionTts(data) {
  const token = ++hostQuestionTtsToken;
  const socket = getRoomQuizSocket();
  const questionIndex = data?.questionIndex;

  try {
    await playHostUncleTommyTts(data?.audioContent, data?.format);
  } catch (err) {
    console.warn(err?.message || "Could not play question TTS.");
  }

  if (token !== hostQuestionTtsToken) return;
  socket.emit("question_tts_done", { questionIndex });
}

function renderHostQuizQuestion(data, { preparing = false, transition = true } = {}) {
  $("#screen-host-quiz-preview")?.classList.remove("is-read-phase");
  resetMcqReadProgress($("#host-quiz-preview-progress"));
  const screen = $("#screen-host-quiz-question");
  const isFastMode = !!data.fastMode;
  const questionText = data.text || "";
  const questionImageUrl = resolvedMediaUrl(data.image);
  const hasQuestionImage = !!questionImageUrl;
  screen?.classList.toggle("fast-mode", isFastMode);
  screen?.classList.toggle("has-image", hasQuestionImage);
  showScreen("host-quiz-question", { transition });
  const pct = ((data.questionIndex + 1) / data.totalQuestions) * 100;
  const points = data.points || (data.fastMode ? 500 : 300);
  $("#host-quiz-progress").style.width = `${pct}%`;
  $("#host-quiz-q-meta").textContent = preparing
    ? uiT("status.getReady")
    : uiT("mcq.questionN", { n: data.questionIndex + 1 });
  $("#host-quiz-points").textContent = uiT("mcq.pts", { n: points });
  setQuestionImage(
    $("#host-quiz-question-image"),
    $("#host-quiz-question-image-wrap"),
    questionImageUrl
  );
  $("#host-quiz-question-text").textContent = questionText;
  renderOptions($("#host-quiz-options"), data.options || [], {
    clickable: false,
    optionLabels: hostMcqOptionLabels(),
    kahootGrid: isHkElderlyVariant(),
  });
  // MC Quiz and the Lightning round size the question identically: short text grows, long text shrinks to fit.
  fitTextToBoxSoon({ max: 64 }, $("#host-quiz-question-text"));
  fitTextToBoxSoon(...document.querySelectorAll("#host-quiz-options .option"));
  $("#host-quiz-answered-count").textContent = preparing
    ? uiT("mcq.startingShortly")
    : isFastMode
      ? uiT("fast.quickInProgress")
      : "";
  const countdownEl = $("#host-quiz-countdown");
  const countdownRing = countdownEl?.closest(".host-mcq-countdown");
  const countdownSeconds = data.timeLimit || 5;
  window.LangoGsap?.startCountdownRing?.(countdownRing, {
    endsAt: Number(data.endsAt) ? serverTimeToLocal(data.endsAt) : Date.now() + countdownSeconds * 1000,
    totalMs: countdownSeconds * 1000,
  });
  let countdownShown = null;
  startDeadlineTimer(data.endsAt, countdownSeconds, (remaining) => {
    const value = Math.max(0, remaining);
    countdownEl.textContent = String(value);
    if (countdownShown !== null) {
      window.LangoGsap?.playCountdownTick?.(countdownEl, { urgent: value > 0 && value <= 3 });
    }
    countdownShown = value;
  });
}

function resultResponseLabel(count) {
  return count === 1
    ? uiT("mcq.responseCountOne", { n: count })
    : uiT("mcq.responseCount", { n: count });
}

function renderHostResultDistribution(question, answerCounts, correctIndex) {
  const options = question?.options || [];
  const total = answerCounts.reduce((sum, count) => sum + count, 0);
  const donut = $("#host-quiz-results-donut");
  const legend = $("#host-quiz-results-legend");

  $("#host-quiz-results-total").textContent = String(total);

  const safeTotal = total || 1;
  let offset = 0;
  const stops = answerCounts.map((count, index) => {
    const start = offset;
    const end = offset + (count / safeTotal) * 100;
    offset = end;
    const color = hostMcqOptionColors()[index] || "#94a3b8";
    return `${color} ${start}% ${end}%`;
  });
  if (donut) {
    donut.style.setProperty("--donut-fill", total ? stops.join(", ") : "#d1d5db 0% 100%");
  }

  if (!legend) return;
  legend.innerHTML = options
    .map((option, index) => {
      const label = hostMcqOptionLabels()[index] || String.fromCharCode(65 + index);
      const color = hostMcqOptionColors()[index] || "#94a3b8";
      const count = answerCounts[index] || 0;
      const isCorrect = index === correctIndex;
      return `<div class="host-mcq-legend-item${isCorrect ? " host-mcq-legend-item--correct" : ""}">
        <span class="host-mcq-legend-label">
          <span class="host-mcq-legend-dot" style="--dot-color: ${color}"></span>
          <span class="host-mcq-legend-letter">${escapeHtml(label)}</span>
          <span class="host-mcq-legend-copy${isCorrect ? " host-mcq-correct-highlight" : ""}">${escapeHtml(option)}</span>
        </span>
        <strong>${escapeHtml(resultResponseLabel(count))}</strong>
      </div>`;
    })
    .join("");
}

// Long questions and answers shrink to fit their cards instead of running into
// the card below or behind the footer buttons.
function fitHostResultText() {
  fitTextToBoxSoon(
    $("#host-quiz-results-question-text"),
    $("#host-quiz-results-correct-answer"),
    $("#host-quiz-results-legend")
  );
}

function initialsForName(name) {
  const parts = String(name || "Student").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "S";
}

// Step 2 of the MC results shows the correct responders full screen. The grid area is about
// 1130 x 385 px: pick the column count that gives every student the largest cell (capped, so a
// handful of students stay close together instead of spreading across the stage) and hide names
// once cells get too small to read.
const CORRECT_BOARD_W = 1130;
const CORRECT_BOARD_H = 385;
const CORRECT_BOARD_MAX = 60;
const CORRECT_CELL_MAX_W = 220;
const CORRECT_CELL_MAX_H = 210;

function correctBoardLayout(count) {
  let best = null;
  for (let cols = 1; cols <= Math.min(12, count); cols += 1) {
    const rows = Math.ceil(count / cols);
    const cell = Math.min(CORRECT_BOARD_W / cols, CORRECT_BOARD_H / rows, CORRECT_CELL_MAX_W, CORRECT_CELL_MAX_H);
    // Prefer wider boards on ties so small classes read as one row.
    if (!best || cell >= best.cell - 0.5) best = { cols, rows, cell };
  }
  const cellW = Math.min(CORRECT_BOARD_W / best.cols, CORRECT_CELL_MAX_W);
  const cellH = Math.min(CORRECT_BOARD_H / best.rows, CORRECT_CELL_MAX_H);
  const names = Math.min(cellW, cellH) >= 84;
  return {
    cols: best.cols,
    rows: best.rows,
    cellW,
    cellH,
    avatar: Math.round(Math.min(140, (names ? cellH - 34 : cellH) * 0.78, cellW * 0.72)),
    names,
  };
}

function renderCorrectResponders(results) {
  const container = $("#host-quiz-correct-responders");
  if (!container) return;
  const countEl = $("#host-quiz-correct-count");
  const all = results || [];
  // Faster correct answers earn more points, so they lead the board.
  const correct = all
    .filter((result) => result.correct)
    .sort((a, b) => (b.points || 0) - (a.points || 0));
  if (countEl) {
    countEl.hidden = !all.length;
    countEl.textContent = `${correct.length} / ${all.length}`;
  }
  if (!correct.length) {
    container.className = "host-mcq-correct-grid";
    container.removeAttribute("style");
    container.innerHTML = `<p class="host-mcq-correct-empty">${uiT("mcq.noCorrectYet")}</p>`;
    return;
  }

  const shown = correct.length > CORRECT_BOARD_MAX ? correct.slice(0, CORRECT_BOARD_MAX - 1) : correct;
  const extra = correct.length - shown.length;
  const layout = correctBoardLayout(shown.length + (extra ? 1 : 0));
  container.className = `host-mcq-correct-grid${layout.names ? "" : " is-compact"}${shown.length > 24 ? " is-crowded" : ""}`;
  container.style.setProperty("--cols", layout.cols);
  container.style.setProperty("--rows", layout.rows);
  container.style.setProperty("--cell-w", `${layout.cellW}px`);
  container.style.setProperty("--cell-h", `${layout.cellH}px`);
  container.style.setProperty("--avatar", `${layout.avatar}px`);

  container.innerHTML =
    shown
      .map((result, index) => {
        const name = String(result.name || "Student").trim() || "Student";
        return `<div class="host-mcq-correct-student" style="--student-i: ${index}" title="${escapeHtml(name)}">
        <div class="host-mcq-correct-avatar">${escapeHtml(initialsForName(name))}</div>
        <p>${escapeHtml(name)}</p>
      </div>`;
      })
      .join("") +
    (extra
      ? `<div class="host-mcq-correct-student" style="--student-i: ${shown.length}">
        <div class="host-mcq-correct-avatar host-mcq-correct-more">+${extra}</div>
      </div>`
      : "");
}

function renderFastAccuracyLeaderboard(results, totalQuestions = 0) {
  const container = $("#host-fast-result-groups");
  const pulse = $("#host-fast-result-pulse");
  const screen = $("#screen-host-fast-results");
  if (!container) return;

  const rows = (results || [])
    .map((student) => {
      const correctAnswers = Math.max(0, Number(student.correctAnswers) || 0);
      const calculatedPercent = totalQuestions
        ? Math.round((correctAnswers / totalQuestions) * 100)
        : 0;
      const accuracyPercent = Math.max(
        0,
        Math.min(100, Number(student.accuracyPercent) || calculatedPercent)
      );
      return {
        name: String(student.name || "Student").trim() || "Student",
        correctAnswers,
        accuracyPercent,
      };
    })
    .sort(
      (a, b) =>
        b.correctAnswers - a.correctAnswers ||
        b.accuracyPercent - a.accuracyPercent ||
        a.name.localeCompare(b.name)
    );

  if (!rows.length) {
    container.innerHTML = `<p class="host-fast-result-empty">${uiT("fast.noResponses")}</p>`;
    if (pulse) pulse.innerHTML = "";
    return;
  }

  const perfect = rows.filter((row) => totalQuestions && row.correctAnswers >= totalQuestions).length;
  const classAvg = Math.round(
    rows.reduce((sum, row) => sum + row.accuracyPercent, 0) / rows.length
  );
  if (pulse) {
    pulse.innerHTML = `
      <div class="host-fast-result-pulse-chip">
        <strong>${perfect}</strong>
        <span>${uiT("fast.perfectCount")}</span>
      </div>
      <div class="host-fast-result-pulse-chip">
        <strong>${classAvg}%</strong>
        <span>${uiT("fast.classAvg")}</span>
      </div>`;
  }

  const podium = rows.slice(0, 3)
    .map((row, index) => {
      const rank = index + 1;
      const initial = escapeHtml(initialsForName(row.name));
      const detail = totalQuestions
        ? uiT("leaderboard.correctOfTotal", { correct: row.correctAnswers, total: totalQuestions })
        : uiT("leaderboard.correctCount", { correct: row.correctAnswers });
      return `<li class="host-fast-result-podium-row host-fast-result-podium-row--${rank}" data-reveal="podium" data-reveal-order="${4 - rank}">
        <div class="host-fast-result-podium-person">
          ${rank === 1 ? '<span class="host-fast-result-crown" aria-hidden="true"></span>' : ""}
          <span class="host-fast-result-avatar">${initial}</span>
          <span class="host-fast-result-name">${escapeHtml(row.name)}</span>
          <span class="host-fast-result-score-pill">
            <span class="host-fast-result-score" data-score-value="${row.accuracyPercent}">${row.accuracyPercent}%</span>
          </span>
          <span class="host-fast-result-detail">${escapeHtml(detail)}</span>
        </div>
        <div class="host-fast-result-plinth" aria-hidden="true">
          <span class="host-fast-result-plinth-num">${rank}</span>
        </div>
      </li>`;
    })
    .join("");

  const sheet = rows.slice(3)
    .map((row, index) => {
      const rank = index + 4;
      const initial = escapeHtml(initialsForName(row.name));
      const detail = totalQuestions
        ? uiT("leaderboard.correctOfTotal", { correct: row.correctAnswers, total: totalQuestions })
        : uiT("leaderboard.correctCount", { correct: row.correctAnswers });
      return `<li class="host-fast-result-ranking-row" data-reveal="rank">
        <span class="host-fast-result-ranking-rank">${rank}</span>
        <span class="host-fast-result-avatar host-fast-result-avatar--sm" aria-hidden="true">${initial}</span>
        <span class="host-fast-result-ranking-name">${escapeHtml(row.name)}</span>
        <span class="host-fast-result-ranking-meta">
          <strong class="host-fast-result-score" data-score-value="${row.accuracyPercent}">${row.accuracyPercent}%</strong>
          <small>${escapeHtml(detail)}</small>
        </span>
      </li>`;
    })
    .join("");

  container.innerHTML = `<div class="host-fast-result-arena host-leaderboard__arena">
    <div class="host-fast-result-spotlight">
      <ol class="host-fast-result-podium" aria-label="${escapeHtml(uiT("leaderboard.topOfClass"))}">${podium}</ol>
    </div>
    <section class="host-fast-result-sheet">
      <div class="host-fast-result-sheet-handle" aria-hidden="true"></div>
      <ol class="host-fast-result-rankings" start="4">${sheet || `<li class="host-fast-result-empty host-fast-result-empty--sheet">${uiT("leaderboard.noOtherScores")}</li>`}</ol>
    </section>
  </div>`;

  requestAnimationFrame(() => {
    if (window.LangoGsap?.playLeaderboardReveal && screen) {
      window.LangoGsap.playLeaderboardReveal(screen, { boardRoot: container });
    }
  });
}

function setupHostRoomQuizSocket(socket) {
  socket.on("game_starting", ({ fastMode } = {}) => {
    roomQuizFastMode = !!fastMode;
  });

  socket.on("question_preview", (data) => {
    noteServerClock(data?.serverNow);
    roomQuizFastMode = !!data.fastMode;
    renderHostQuizPreview(data);
  });

  socket.on("question_speaking", (data) => {
    roomQuizFastMode = !!data.fastMode;
    hostQuestionTtsToken += 1;
    if (typeof stopBuzzinBase64Audio === "function") stopBuzzinBase64Audio();
    renderHostQuizSpeaking(data);
  });

  socket.on("question_tts", (data) => {
    void playHostQuestionTts(data);
  });

  socket.on("question_start", (data) => {
    noteServerClock(data?.serverNow);
    roomQuizCurrentQuestion = data;
    hostQuestionTtsToken += 1;
    const fromPreview =
      $("#screen-host-quiz-preview")?.classList.contains("active") ||
      $("#screen-host-quiz-question")?.classList.contains("active");
    renderHostQuizQuestion(data, { transition: !fromPreview });
  });

  socket.on("question_between", ({ isLast } = {}) => {
    if (!roomQuizFastMode) return;
    clearTimer();
    $("#screen-host-quiz-question")?.classList.add("fast-mode");
    showScreen("host-quiz-question");
    $("#host-quiz-answered-count").textContent = isLast
      ? uiT("fast.calculatingFinal")
      : uiT("mcq.nextComing");
  });

  socket.on("question_results", ({ correctIndex, answerCounts, results, leaderboard }) => {
    clearTimer();
    if (roomQuizFastMode) return;
    showScreen("host-quiz-results");
    const q = roomQuizCurrentQuestion;
    const correctAnswer = q?.options?.[correctIndex] || "";
    const points = q?.points || (q?.fastMode ? 500 : 300);
    const questionImageUrl = resolvedMediaUrl(q?.image);
    $("#screen-host-quiz-results")?.classList.toggle("has-image", !!questionImageUrl);
    setQuestionImage(
      $("#host-quiz-results-image"),
      $("#host-quiz-results-image-wrap"),
      questionImageUrl
    );
    $("#host-quiz-results-points").textContent = uiT("mcq.pts", { n: points });
    $("#host-quiz-results-question-text").textContent = q?.text || "";
    const correctLabel = hostMcqOptionLabels()[correctIndex] || "";
    const correctAnswerEl = $("#host-quiz-results-correct-answer");
    if (correctAnswerEl) {
      const label = uiT("mcq.correctAnswer");
      correctAnswerEl.innerHTML = correctAnswer
        ? `${escapeHtml(label)} <span class="host-mcq-correct-letter">${escapeHtml(correctLabel)}</span> <span class="host-mcq-correct-highlight">${escapeHtml(correctAnswer)}</span>`
        : escapeHtml(label);
    }
    const boardAnswerEl = $("#host-quiz-correct-board-answer");
    if (boardAnswerEl) {
      boardAnswerEl.innerHTML = correctAnswer
        ? `${escapeHtml(uiT("mcq.correctAnswer"))} <span class="host-mcq-correct-letter">${escapeHtml(correctLabel)}</span> <strong>${escapeHtml(correctAnswer)}</strong>`
        : "";
    }
    $("#host-quiz-results-bars").innerHTML = "";
    renderHostResultDistribution(q, answerCounts, correctIndex);
    fitHostResultText();
    renderCorrectResponders(results);
    renderLeaderboard($("#host-quiz-leaderboard"), leaderboard);
    const isLast = q && q.questionIndex + 1 >= q.totalQuestions;
    // Step 1: question + answer + distribution; the first Next click shows the correct responders.
    beginHostResultsSteps(isLast ? uiT("quiz.showFinalResults") : uiT("quiz.nextQuestion"));
  });

  socket.on("game_finished", ({ leaderboard, accuracyLeaderboard, answerReview, semesterLeaderboard, exerciseLeaderboard }) => {
    const wasFastMode = roomQuizFastMode;
    roomQuizFastMode = false;
    if (typeof markCurrentHostExerciseCompleted === "function") {
      markCurrentHostExerciseCompleted();
    }
    if (wasFastMode) {
      renderFastAccuracyLeaderboard(accuracyLeaderboard || [], answerReview?.length || 0);
      showScreen("host-fast-results");
      if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
      return;
    }
    showScreen("host-quiz-finished");
    showExerciseLeaderboards({
      exerciseLeaderboard: exerciseLeaderboard || leaderboard,
      semesterLeaderboard,
      accuracyLeaderboard,
      totalQuestions: answerReview?.length || 0,
      exerciseListEl: $("#host-quiz-final-leaderboard"),
      semesterListEl: $("#host-semester-leaderboard"),
      semesterWrapEl: $("#host-semester-leaderboard-wrap"),
      exerciseWrapEl: $("#host-exercise-leaderboard-wrap"),
    });
    if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  });

  socket.on("game_ended", ({ reason }) => {
    alert(reason || uiT("status.quizEnded"));
  });
}

let hostVideoControlsReady = false;
let hostVideoScrubbing = false;
let hostVideoControlsHideTimer = null;
let hostVideoPlaybackRate = 1;
let hostVideoCaptionsEnabled = true;
let hostVideoCaptionCuesByLang = {};
let hostVideoCaptionTracks = [];
let hostVideoCaptionLanguages = [];
let hostVideoCaptionLoadToken = 0;
let hostVideoSpeedMenuOpen = false;
let hostVideoLangMenuOpen = false;

const HOST_VIDEO_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HOST_VIDEO_MAX_CAPTION_LANGS = 2;

function formatHostVideoSpeedLabel(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return "1x";
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}x`;
}

function hostVideoCaptionLanguageLabel(code) {
  if (typeof captionLanguageMeta === "function") {
    return captionLanguageMeta(code).label;
  }
  return String(code || "EN").toUpperCase();
}

function hostVideoActiveCaptionLanguages() {
  return hostVideoCaptionLanguages.filter((language) =>
    hostVideoCaptionTracks.some((track) => track.language === language)
  );
}

function hostVideoHasLoadedCaptionCues() {
  return hostVideoActiveCaptionLanguages().some(
    (language) => (hostVideoCaptionCuesByLang[language] || []).length > 0
  );
}

function formatHostVideoCaptionLangLabel(languages) {
  const active = (languages || []).filter(Boolean);
  if (!active.length) return "EN";
  return active.map((language) => hostVideoCaptionLanguageLabel(language)).join(" + ");
}

function cueTextAtTime(cues, currentTime) {
  return (cues || [])
    .filter((cue) => currentTime >= cue.start && currentTime <= cue.end)
    .map((cue) => cue.text)
    .join("\n");
}

function parseHostVideoVttTimestamp(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const fraction = String(match[4] || "0").padEnd(3, "0").slice(0, 3);
  return hours * 3600 + minutes * 60 + seconds + Number(fraction) / 1000;
}

function parseHostVideoWebVtt(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n");
  const cues = [];
  let index = 0;

  if (/^WEBVTT/i.test(lines[0] || "")) index = 1;

  while (index < lines.length) {
    while (index < lines.length && !String(lines[index] || "").trim()) index += 1;
    if (index >= lines.length) break;

    let line = String(lines[index] || "").trim();
    if (/^\d+$/.test(line)) {
      index += 1;
      line = String(lines[index] || "").trim();
    }

    const timing = line.match(
      /^((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/
    );
    if (!timing) {
      index += 1;
      continue;
    }

    const start = parseHostVideoVttTimestamp(timing[1]);
    const end = parseHostVideoVttTimestamp(timing[2]);
    index += 1;
    const textLines = [];
    while (index < lines.length && String(lines[index] || "").trim()) {
      textLines.push(String(lines[index]).trim());
      index += 1;
    }

    if (Number.isFinite(start) && Number.isFinite(end) && end > start && textLines.length) {
      cues.push({
        start,
        end,
        text: textLines.join("\n"),
      });
    }
  }

  return cues;
}

function setHostVideoLangMenuOpen(open) {
  const wrap = document.querySelector("#screen-host-video .host-video-lang-wrap");
  const button = $("#host-video-lang");
  const menu = $("#host-video-lang-menu");
  hostVideoLangMenuOpen = Boolean(open);
  wrap?.classList.toggle("is-open", hostVideoLangMenuOpen);
  if (button) button.setAttribute("aria-expanded", hostVideoLangMenuOpen ? "true" : "false");
  if (menu) menu.hidden = !hostVideoLangMenuOpen;
  if (hostVideoLangMenuOpen) {
    setHostVideoSpeedMenuOpen(false);
    setHostVideoControlsVisible(true);
  }
}

function renderHostVideoLanguageMenu() {
  const menu = $("#host-video-lang-menu");
  const button = $("#host-video-lang");
  const label = $("#host-video-lang-label");
  if (!menu || !button) return;

  const active = new Set(hostVideoActiveCaptionLanguages());
  const canPickDual = hostVideoCaptionTracks.length > 1;
  const options = hostVideoCaptionTracks
    .map((track) => {
      const isActive = active.has(track.language);
      return `<button type="button" class="host-video-lang-option${isActive ? " is-active" : ""}" role="menuitemcheckbox" data-lang="${escapeHtml(track.language)}" aria-checked="${isActive ? "true" : "false"}">${escapeHtml(track.label || hostVideoCaptionLanguageLabel(track.language))}</button>`;
    })
    .join("");

  menu.innerHTML = `${
    canPickDual
      ? `<p class="host-video-lang-hint">${escapeHtml(uiT("video.pickTwoLanguages"))}</p>`
      : ""
  }${options}`;

  const hasTracks = hostVideoCaptionTracks.length > 0;
  button.disabled = !hasTracks;
  if (label) {
    label.textContent = hasTracks
      ? formatHostVideoCaptionLangLabel(hostVideoActiveCaptionLanguages())
      : "EN";
  }
}

function clearHostVideoCaptions({ keepTracks = false } = {}) {
  hostVideoCaptionLoadToken += 1;
  hostVideoCaptionCuesByLang = {};
  if (!keepTracks) {
    hostVideoCaptionTracks = [];
    hostVideoCaptionLanguages = [];
  }
  const captionEl = $("#host-video-captions");
  if (captionEl) {
    captionEl.innerHTML = "";
    captionEl.hidden = true;
  }
  renderHostVideoLanguageMenu();
  syncHostVideoCaptionDisplay();
}

function syncHostVideoCaptionDisplay() {
  const captionEl = $("#host-video-captions");
  const cc = $("#host-video-cc");
  const screen = $("#screen-host-video");
  const video = $("#host-video-player");
  if (!captionEl) return;

  const languages = hostVideoActiveCaptionLanguages();
  const hasCaptions = hostVideoHasLoadedCaptionCues();
  const lines = [];

  if (hasCaptions && hostVideoCaptionsEnabled && video) {
    const current = Number(video.currentTime) || 0;
    for (const language of languages) {
      const text = cueTextAtTime(hostVideoCaptionCuesByLang[language], current).trim();
      if (text) lines.push({ language, text });
    }
  }

  captionEl.innerHTML = lines
    .map(
      (line, index) =>
        `<div class="host-video-caption-line${index === 0 ? " is-primary" : " is-secondary"}" data-lang="${escapeHtml(line.language)}">${escapeHtml(line.text)}</div>`
    )
    .join("");
  captionEl.hidden = !lines.length;
  captionEl.classList.toggle("is-dual", lines.length > 1);
  screen?.classList.toggle("has-captions-on", hasCaptions && hostVideoCaptionsEnabled);
  if (cc) {
    cc.disabled = !hasCaptions && !hostVideoCaptionTracks.length;
    cc.setAttribute("aria-pressed", hasCaptions && hostVideoCaptionsEnabled ? "true" : "false");
    cc.classList.toggle("is-active", hasCaptions && hostVideoCaptionsEnabled);
    cc.title = hasCaptions
      ? hostVideoCaptionsEnabled
        ? uiT("video.hideSubtitles")
        : uiT("video.showSubtitles")
      : uiT("video.noSubtitles");
  }
}

async function ensureHostVideoCaptionLanguageLoaded(language) {
  const nextLanguage =
    typeof normalizeCaptionLanguage === "function"
      ? normalizeCaptionLanguage(language, hostVideoCaptionLanguages[0] || "en")
      : String(language || hostVideoCaptionLanguages[0] || "en");
  const track = hostVideoCaptionTracks.find((entry) => entry.language === nextLanguage);
  if (!track?.url) return false;
  if ((hostVideoCaptionCuesByLang[track.language] || []).length) return true;

  const loadToken = hostVideoCaptionLoadToken;
  try {
    const res = await fetch(track.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Caption fetch failed (${res.status})`);
    const text = await res.text();
    if (loadToken !== hostVideoCaptionLoadToken) return false;
    const cues = parseHostVideoWebVtt(text);
    if (!cues.length) throw new Error("Caption file has no cues.");
    hostVideoCaptionCuesByLang[track.language] = cues;
    return true;
  } catch (err) {
    console.warn("Could not load video captions:", err);
    if (loadToken === hostVideoCaptionLoadToken) {
      hostVideoCaptionCuesByLang[track.language] = [];
    }
    return false;
  }
}

async function setHostVideoCaptionLanguages(languages, { enable = true } = {}) {
  const normalized = [];
  const seen = new Set();
  for (const language of languages || []) {
    const code =
      typeof normalizeCaptionLanguage === "function"
        ? normalizeCaptionLanguage(language, "")
        : String(language || "").trim().toLowerCase();
    if (!code || seen.has(code)) continue;
    if (!hostVideoCaptionTracks.some((track) => track.language === code)) continue;
    seen.add(code);
    normalized.push(code);
    if (normalized.length >= HOST_VIDEO_MAX_CAPTION_LANGS) break;
  }

  hostVideoCaptionLanguages = normalized;
  renderHostVideoLanguageMenu();

  if (!normalized.length) {
    syncHostVideoCaptionDisplay();
    return;
  }

  const loadToken = ++hostVideoCaptionLoadToken;
  await Promise.all(normalized.map((language) => ensureHostVideoCaptionLanguageLoaded(language)));
  if (loadToken !== hostVideoCaptionLoadToken) return;

  if (enable) hostVideoCaptionsEnabled = true;
  syncHostVideoCaptionDisplay();
}

async function toggleHostVideoCaptionLanguage(language) {
  const code =
    typeof normalizeCaptionLanguage === "function"
      ? normalizeCaptionLanguage(language, "")
      : String(language || "").trim().toLowerCase();
  if (!code || !hostVideoCaptionTracks.some((track) => track.language === code)) return;

  const current = hostVideoActiveCaptionLanguages();
  const index = current.indexOf(code);
  let next = current.slice();

  if (index >= 0) {
    if (current.length === 1) return;
    next.splice(index, 1);
  } else if (current.length < HOST_VIDEO_MAX_CAPTION_LANGS) {
    next.push(code);
  } else {
    next = [current[0], code];
  }

  await setHostVideoCaptionLanguages(next);
}

async function attachHostVideoCaptions(video, exercise) {
  clearHostVideoCaptions();
  if (!video) return;

  hostVideoCaptionTracks =
    typeof captionTracksFromExercise === "function" ? captionTracksFromExercise(exercise) : [];
  if (!hostVideoCaptionTracks.length) {
    syncHostVideoCaptionDisplay();
    return;
  }

  const preferred =
    (typeof normalizeCaptionLanguage === "function"
      ? normalizeCaptionLanguage(exercise?.items?.[0]?.captionLanguage, hostVideoCaptionTracks[0].language)
      : hostVideoCaptionTracks[0].language) || hostVideoCaptionTracks[0].language;
  await setHostVideoCaptionLanguages([preferred]);
}

function setHostVideoControlsVisible(visible, { autoHide = false } = {}) {
  const screen = $("#screen-host-video");
  const video = $("#host-video-player");
  if (!screen || !video) return;

  if (hostVideoControlsHideTimer) {
    clearTimeout(hostVideoControlsHideTimer);
    hostVideoControlsHideTimer = null;
  }

  screen.classList.toggle("controls-visible", visible);
  if (
    visible &&
    autoHide &&
    !video.paused &&
    !video.ended &&
    !hostVideoScrubbing &&
    !hostVideoSpeedMenuOpen &&
    !hostVideoLangMenuOpen
  ) {
    hostVideoControlsHideTimer = setTimeout(() => {
      screen.classList.remove("controls-visible");
      hostVideoControlsHideTimer = null;
    }, 1200);
  }
}

function formatHostVideoTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function setHostVideoSpeedMenuOpen(open) {
  const wrap = document.querySelector("#screen-host-video .host-video-speed-wrap");
  const button = $("#host-video-speed");
  const menu = $("#host-video-speed-menu");
  hostVideoSpeedMenuOpen = Boolean(open);
  wrap?.classList.toggle("is-open", hostVideoSpeedMenuOpen);
  if (button) button.setAttribute("aria-expanded", hostVideoSpeedMenuOpen ? "true" : "false");
  if (menu) menu.hidden = !hostVideoSpeedMenuOpen;
  if (hostVideoSpeedMenuOpen) {
    setHostVideoLangMenuOpen(false);
    setHostVideoControlsVisible(true);
  }
}

function setHostVideoPlaybackRate(rate) {
  const video = $("#host-video-player");
  const nextRate = HOST_VIDEO_SPEEDS.includes(Number(rate)) ? Number(rate) : 1;
  hostVideoPlaybackRate = nextRate;
  if (video) video.playbackRate = nextRate;

  const label = $("#host-video-speed-label");
  if (label) label.textContent = formatHostVideoSpeedLabel(nextRate);

  document.querySelectorAll("#host-video-speed-menu .host-video-speed-option").forEach((option) => {
    const isActive = Number(option.dataset.rate) === nextRate;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-checked", isActive ? "true" : "false");
  });
}

function updateHostVideoControls() {
  const screen = $("#screen-host-video");
  const video = $("#host-video-player");
  const scrubber = $("#host-video-scrubber");
  const current = $("#host-video-current");
  const duration = $("#host-video-duration");
  const play = $("#host-video-play");
  const mute = $("#host-video-mute");
  if (!screen || !video || !scrubber) return;

  const videoDuration = Number.isFinite(video.duration) ? video.duration : 0;
  const progress = videoDuration > 0 ? video.currentTime / videoDuration : 0;
  const progressValue = Math.round(progress * 1000);

  if (!hostVideoScrubbing) {
    scrubber.value = String(progressValue);
  }
  scrubber.style.setProperty("--host-video-progress", `${Math.max(0, Math.min(100, progress * 100))}%`);
  if (current) current.textContent = formatHostVideoTime(video.currentTime);
  if (duration) duration.textContent = formatHostVideoTime(videoDuration);
  screen.classList.toggle("is-playing", !video.paused && !video.ended);
  screen.classList.toggle("is-muted", video.muted || video.volume === 0);
  if (play) play.setAttribute("aria-label", video.paused ? uiT("video.play") : uiT("video.pause"));
  if (mute) mute.setAttribute("aria-label", video.muted || video.volume === 0 ? uiT("video.unmute") : uiT("video.mute"));

  if (Number.isFinite(video.playbackRate) && video.playbackRate > 0) {
    const matched = HOST_VIDEO_SPEEDS.find((rate) => Math.abs(rate - video.playbackRate) < 0.001);
    if (matched != null && matched !== hostVideoPlaybackRate) {
      setHostVideoPlaybackRate(matched);
    } else {
      const label = $("#host-video-speed-label");
      if (label) label.textContent = formatHostVideoSpeedLabel(video.playbackRate || hostVideoPlaybackRate);
    }
  }
  syncHostVideoCaptionDisplay();
}

function seekHostVideoFromScrubber() {
  const video = $("#host-video-player");
  const scrubber = $("#host-video-scrubber");
  if (!video || !scrubber || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const progress = Number(scrubber.value) / Number(scrubber.max || 1000);
  video.currentTime = Math.max(0, Math.min(video.duration, video.duration * progress));
  scrubber.style.setProperty("--host-video-progress", `${Math.max(0, Math.min(100, progress * 100))}%`);
  updateHostVideoControls();
}

function setupHostVideoControls() {
  if (hostVideoControlsReady) return;
  const video = $("#host-video-player");
  const play = $("#host-video-play");
  const scrubber = $("#host-video-scrubber");
  const mute = $("#host-video-mute");
  const speedBtn = $("#host-video-speed");
  const speedMenu = $("#host-video-speed-menu");
  const langBtn = $("#host-video-lang");
  const langMenu = $("#host-video-lang-menu");
  const ccBtn = $("#host-video-cc");
  const frame = document.querySelector("#screen-host-video .host-video-frame");
  if (!video || !play || !scrubber || !mute || !frame) return;

  hostVideoControlsReady = true;

  play.addEventListener("click", () => {
    if (video.paused || video.ended) {
      video.play().catch(() => {
        /* Ignore autoplay or gesture restrictions. */
      });
    } else {
      video.pause();
    }
  });

  video.addEventListener("click", () => {
    setHostVideoSpeedMenuOpen(false);
    setHostVideoLangMenuOpen(false);
    if (video.paused || video.ended) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });

  mute.addEventListener("click", () => {
    video.muted = !video.muted;
    updateHostVideoControls();
  });

  speedBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    setHostVideoLangMenuOpen(false);
    setHostVideoSpeedMenuOpen(!hostVideoSpeedMenuOpen);
    setHostVideoControlsVisible(true);
  });

  speedMenu?.addEventListener("click", (event) => {
    const option = event.target.closest(".host-video-speed-option");
    if (!option) return;
    event.stopPropagation();
    setHostVideoPlaybackRate(Number(option.dataset.rate));
    setHostVideoSpeedMenuOpen(false);
    setHostVideoControlsVisible(true, { autoHide: true });
  });

  langBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!hostVideoCaptionTracks.length) return;
    setHostVideoSpeedMenuOpen(false);
    setHostVideoLangMenuOpen(!hostVideoLangMenuOpen);
    setHostVideoControlsVisible(true);
  });

  langMenu?.addEventListener("click", (event) => {
    const option = event.target.closest(".host-video-lang-option");
    if (!option) return;
    event.stopPropagation();
    const nextLang = option.dataset.lang;
    void toggleHostVideoCaptionLanguage(nextLang);
    setHostVideoControlsVisible(true);
  });

  ccBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!hostVideoHasLoadedCaptionCues() && !hostVideoCaptionTracks.length) return;
    hostVideoCaptionsEnabled = !hostVideoCaptionsEnabled;
    syncHostVideoCaptionDisplay();
    setHostVideoControlsVisible(true, { autoHide: true });
  });

  document.addEventListener("click", (event) => {
    if (hostVideoSpeedMenuOpen) {
      const wrap = document.querySelector("#screen-host-video .host-video-speed-wrap");
      if (wrap && !wrap.contains(event.target)) {
        setHostVideoSpeedMenuOpen(false);
      }
    }
    if (hostVideoLangMenuOpen) {
      const wrap = document.querySelector("#screen-host-video .host-video-lang-wrap");
      if (wrap && !wrap.contains(event.target)) {
        setHostVideoLangMenuOpen(false);
      }
    }
  });

  video.addEventListener("play", () => {
    const isolate =
      typeof shouldIsolateHostBgmForMedia !== "function" || shouldIsolateHostBgmForMedia();
    if (isolate && typeof fadeOutHostBgm === "function") fadeOutHostBgm();
    setHostVideoControlsVisible(true, { autoHide: true });
  });

  video.addEventListener("pause", () => setHostVideoControlsVisible(true));

  video.addEventListener("ended", () => {
    if (typeof fadeInHostBgm === "function") fadeInHostBgm();
    setHostVideoControlsVisible(true);
  });

  frame.addEventListener("pointermove", () => {
    setHostVideoControlsVisible(true, { autoHide: true });
  });

  frame.addEventListener("pointerleave", () => {
    if (
      !video.paused &&
      !video.ended &&
      !hostVideoScrubbing &&
      !hostVideoSpeedMenuOpen &&
      !hostVideoLangMenuOpen
    ) {
      setHostVideoControlsVisible(false);
    }
  });

  scrubber.addEventListener("input", () => {
    hostVideoScrubbing = true;
    setHostVideoControlsVisible(true);
    seekHostVideoFromScrubber();
  });

  scrubber.addEventListener("change", () => {
    seekHostVideoFromScrubber();
    hostVideoScrubbing = false;
    updateHostVideoControls();
    setHostVideoControlsVisible(true, { autoHide: true });
  });

  scrubber.addEventListener("pointerup", () => {
    hostVideoScrubbing = false;
    updateHostVideoControls();
    setHostVideoControlsVisible(true, { autoHide: true });
  });

  ["loadedmetadata", "durationchange", "timeupdate", "play", "pause", "ended", "volumechange", "ratechange"].forEach(
    (eventName) => {
      video.addEventListener(eventName, updateHostVideoControls);
    }
  );
}

function resetHostVideoControls() {
  const scrubber = $("#host-video-scrubber");
  hostVideoScrubbing = false;
  setHostVideoSpeedMenuOpen(false);
  setHostVideoLangMenuOpen(false);
  setHostVideoPlaybackRate(hostVideoPlaybackRate || 1);
  if (scrubber) {
    scrubber.value = "0";
    scrubber.style.setProperty("--host-video-progress", "0%");
  }
  setHostVideoControlsVisible(true);
  updateHostVideoControls();
}

function stopHostVideoPlayback() {
  stopHostLecture();
  const video = $("#host-video-player");
  if (!video) return;
  video.pause();
  setHostVideoSpeedMenuOpen(false);
  setHostVideoLangMenuOpen(false);
  updateHostVideoControls();
}

let hostLecturePlayer = null;
let hostLectureMountId = 0;

function stopHostLecture() {
  hostLectureMountId += 1;
  hostLecturePlayer?.destroy();
  hostLecturePlayer = null;
  const holder = $("#host-video-lecture");
  if (holder) {
    holder.replaceChildren();
    holder.hidden = true;
  }
  $("#screen-host-video")?.classList.remove("is-lecture");
}

/** Plays a lecture.json live (lecture-player.js) in the video frame instead of an MP4. */
function showHostLectureExercise(exercise, url) {
  stopHostLecture();
  const video = $("#host-video-player");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  clearHostVideoCaptions();

  $("#host-video-title").textContent = exercise.title || "Video";
  $("#host-video-subtitle").textContent = exercise.subTitle || "";
  const screen = $("#screen-host-video");
  screen?.classList.toggle("has-subtitle", Boolean(exercise.subTitle));
  screen?.classList.add("has-video", "is-lecture");

  // A fresh element per lecture, so a slow load that finishes after we moved on cannot touch the next one.
  const holder = $("#host-video-lecture");
  const el = document.createElement("div");
  holder.replaceChildren(el);
  holder.hidden = false;
  el.addEventListener("lecture-ended", () => {
    if (typeof fadeInHostBgm === "function") fadeInHostBgm();
  });
  const mountId = hostLectureMountId;
  if (typeof LangoLecturePlayer === "undefined") {
    el.textContent = "Lecture player failed to load.";
  } else {
    LangoLecturePlayer.mount(el, url)
      .then((player) => {
        if (mountId === hostLectureMountId) hostLecturePlayer = player;
        else player.destroy();
      })
      .catch((error) => console.error("[host] lecture failed", error));
  }

  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  const isolate =
    typeof shouldIsolateHostBgmForMedia !== "function" || shouldIsolateHostBgmForMedia();
  if (isolate && typeof fadeOutHostBgm === "function") fadeOutHostBgm();
  showScreen("host-video");
}

/** Plays a slides exercise (slides-player.js) in the video frame, like a lecture. */
function showHostSlidesExercise(exercise) {
  stopHostLecture();
  const video = $("#host-video-player");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  clearHostVideoCaptions();

  $("#host-video-title").textContent = exercise.title || uiT("exercise.slidesFallback");
  $("#host-video-subtitle").textContent = exercise.subTitle || "";
  const screen = $("#screen-host-video");
  screen?.classList.toggle("has-subtitle", Boolean(exercise.subTitle));
  screen?.classList.add("has-video", "is-lecture");

  const holder = $("#host-video-lecture");
  const el = document.createElement("div");
  el.className = "host-slides-mount";
  holder.replaceChildren(el);
  holder.hidden = false;
  if (typeof LangoSlidesPlayer === "undefined") {
    el.textContent = "Slides player failed to load.";
  } else {
    hostLectureMountId += 1;
    hostLecturePlayer = LangoSlidesPlayer.mount(el, exercise, {
      onEnd: () => {
        if (typeof fadeInHostBgm === "function") fadeInHostBgm();
      },
    });
  }

  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  const isolate =
    typeof shouldIsolateHostBgmForMedia !== "function" || shouldIsolateHostBgmForMedia();
  if (isolate && typeof fadeOutHostBgm === "function") fadeOutHostBgm();
  showScreen("host-video");
}

function showHostVideoExercise(exercise) {
  const lectureUrl = lectureUrlFromExercise(exercise);
  if (lectureUrl) {
    showHostLectureExercise(exercise, lectureUrl);
    return;
  }
  stopHostLecture();
  const url = resolvedMediaUrl(videoUrlFromExercise(exercise));
  if (!url) throw new Error("No video URL in this exercise.");

  $("#host-video-title").textContent = exercise.title || "Video";
  $("#host-video-subtitle").textContent = exercise.subTitle || "";
  $("#screen-host-video")?.classList.toggle("has-subtitle", Boolean(exercise.subTitle));
  const video = $("#host-video-player");
  video.controls = false;
  video.defaultMuted = false;
  video.muted = false;
  video.volume = 1;
  video.playbackRate = hostVideoPlaybackRate || 1;
  clearHostVideoCaptions();
  video.src = url;
  video.load();
  void attachHostVideoCaptions(video, exercise);
  setupHostVideoControls();
  resetHostVideoControls();
  $("#screen-host-video")?.classList.add("has-video");
  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  const isolate =
    typeof shouldIsolateHostBgmForMedia !== "function" || shouldIsolateHostBgmForMedia();
  if (isolate && typeof fadeOutHostBgm === "function") fadeOutHostBgm();
  showScreen("host-video");
}

function showHostBuzzinExercise(exercise, roomId) {
  const buzzin = buzzinFromExercise(exercise);
  if (!buzzin) throw new Error("No Buzz In content in this exercise.");

  hostBuzzinActiveExercise = exercise;
  syncHostBuzzinTopic(buzzin.topic, {
    questionIndex: buzzin.questionIndex || 0,
    totalQuestions: buzzin.totalQuestions || buzzin.topics?.length || 1,
    hasNextQuestion: (buzzin.totalQuestions || buzzin.topics?.length || 1) > 1,
  });
  syncHostBuzzinQuestionImage(buzzinImageFromExercise(exercise, buzzin.questionIndex || 0));
  const points = typeof exercisePointsValue === "function" ? exercisePointsValue(exercise) : 300;
  hostBuzzinExercisePoints = points;
  const pointsEl = $("#host-buzzin-points");
  if (pointsEl) {
    pointsEl.textContent = uiT("mcq.pts", { n: points });
  }
  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  showScreen("host-buzzin");
  return startHostBuzzinRound(roomId);
}

function startHostExercise(roomId, exercise) {
  if (isLiveMcQuizExercise(exercise)) {
    if (typeof fadeInHostBgm === "function") fadeInHostBgm();
    return startHostRoomQuiz(roomId, exercise);
  }
  if (isVideoExercise(exercise)) {
    showHostVideoExercise(exercise);
    return Promise.resolve();
  }
  if (isSlidesExercise(exercise)) {
    showHostSlidesExercise(exercise);
    return Promise.resolve();
  }
  if (isBuzzinExercise(exercise)) {
    if (typeof fadeInHostBgm === "function") fadeInHostBgm();
    return showHostBuzzinExercise(exercise, roomId);
  }
  if (isOpenAnswerExercise(exercise)) {
    if (typeof fadeInHostBgm === "function") fadeInHostBgm();
    return showHostOpenAnswerExercise(exercise, roomId);
  }
  return Promise.reject(new Error(`Unsupported exercise type: ${exercise?.type || "unknown"}`));
}

function startHostRoomQuiz(roomId, exercise) {
  const quiz = mcQuizPayloadFromExercise(exercise);
  if (!quiz?.questions?.length) {
    return Promise.reject(new Error("No quiz questions in this exercise."));
  }

  roomQuizFastMode = !!quiz.fastMode;
  const socket = getRoomQuizSocket();
  window.__hostRoomQuizCtx = { roomId };

  return new Promise((resolve, reject) => {
    const onReady = () => {
      socket.emit(
        "create_room_game",
        { roomId, quiz },
        (createRes) => {
          if (!createRes?.ok) {
            reject(new Error(createRes?.error || "Could not start quiz."));
            return;
          }

          socket.emit("start_room_game");
          setupHostRoomQuizReconnect();
          const firstQuestion = quiz.questions[0];
          roomQuizCurrentQuestion = {
            questionIndex: 0,
            totalQuestions: quiz.questions.length,
            text: firstQuestion.text,
            previewSeconds: 5,
            previewEndsAt: Date.now() + 5000,
            fastMode: quiz.fastMode,
            points: quiz.fastMode ? 500 : 300,
            image: resolvedMediaUrl(firstQuestion.image) || null,
          };
          if (quiz.fastMode) {
            renderHostQuizQuestion({
              ...roomQuizCurrentQuestion,
              options: firstQuestion.options,
              timeLimit: firstQuestion.timeLimit || 5,
            }, { preparing: true });
          }
          resolve();
        }
      );
    };

    if (socket.connected) {
      onReady();
    } else {
      socket.once("connect", onReady);
      socket.once("connect_error", () =>
        reject(new Error("Could not connect to quiz server."))
      );
      socket.connect(roomId);
    }
  });
}

// Host quiz socket: on reconnect mid-game, the server has already dropped the
// old host socket; re-join the room so the host keeps receiving updates.
// game state lives server-side per room, so only the socket membership needs
// restoring.
function setupHostRoomQuizReconnect() {
  const socket = getRoomQuizSocket();
  socket.on("reconnect", () => {
    const meta = window.__hostRoomQuizCtx;
    if (meta?.roomId && socket.connected) {
      socket.emit("host_session", { roomId: meta.roomId, uiLocale: currentHostUiLocale?.() }, () => {});
    }
  });
}

if (typeof window !== "undefined") {
  window.setupHostRoomQuizReconnect = setupHostRoomQuizReconnect;
}

// MC results come in two steps: the question, answer and distribution first, then the students who
// answered correctly full screen. The Next button reveals them before it moves on.
let hostResultsBoardPending = false;
let hostResultsNextLabel = "";

function setHostResultsNextLabel(text) {
  const nextBtn = $("#btn-host-quiz-next");
  const nextLabel = nextBtn?.querySelector(".host-btn-label") || nextBtn;
  if (nextLabel) nextLabel.textContent = text;
}

function beginHostResultsSteps(finalNextLabel) {
  const screen = $("#screen-host-quiz-results");
  hostResultsBoardPending = true;
  hostResultsNextLabel = finalNextLabel;
  screen?.classList.remove("is-results-step-2");
  screen?.classList.add("is-results-step-1");
  setHostResultsNextLabel(uiT("common.next"));
}

function revealHostResultsBoard() {
  const screen = $("#screen-host-quiz-results");
  hostResultsBoardPending = false;
  screen?.classList.remove("is-results-step-1");
  screen?.classList.add("is-results-step-2");
  setHostResultsNextLabel(hostResultsNextLabel);
}

function initHostRoomQuizUi() {
  $("#btn-host-quiz-next")?.addEventListener("click", () => {
    if (typeof playPageNextSound === "function") playPageNextSound();
    if (hostResultsBoardPending) {
      revealHostResultsBoard();
      return;
    }
    getRoomQuizSocket().emit("next_question");
  });

  $("#btn-host-buzzin-start")?.addEventListener("click", () => {
    if (typeof playPageNextSound === "function") playPageNextSound();
    void openHostBuzzinJoin().catch((err) => {
      console.warn(err?.message || "Could not start buzz in.");
    });
  });

  getHostBuzzinRandomButtons().forEach((btn) => {
    btn.addEventListener("click", () => {
      if (typeof playPageNextSound === "function") playPageNextSound();
      void openHostBuzzinLuckyDraw();
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHostRoomQuizUi);
} else {
  initHostRoomQuizUi();
}
