/** Socket.IO live exercises for Lango host — content from CMS course detail. */
let roomQuizSocket = null;
let roomQuizCurrentQuestion = null;
let roomQuizFastMode = false;

const HOST_MCQ_OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];
const HOST_MCQ_OPTION_COLORS = ["#15c4f8", "#45c937", "#f33b3d", "#eab308", "#a855f7", "#14b8a6"];
let hostBuzzinUiReady = false;
let hostBuzzinRoomId = null;
let hostBuzzinRoundId = null;
let hostBuzzinJoinTimer = null;
let hostBuzzinLastResponses = [];
const hostBuzzinPlayedSpokenFeedbackAudio = new Set();
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
  setHostBuzzinLeaderboardMode("winner");
  resetHostBuzzinLuckyDrawUi();
}

function hostBuzzinFeedbackAnimateFlags(payload, selectedStudent, currentTurn, response) {
  const topic = String(payload?.topic || "").trim();
  const answerKey = response?.text
    ? `text:${response.text}`
    : currentTurn
      ? "pending"
      : "";
  const feedbackKey = response
    ? `${response.analysisStatus || "none"}:${response.answerVerdict || ""}:${response.analysis || ""}:${response.spokenFeedback || ""}`
    : "";

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

function syncHostBuzzinTopic(topic, meta = null) {
  const text = String(topic || "").trim();
  const questionTopic = $("#host-buzzin-topic");
  const feedbackTopic = $("#host-buzzin-feedback-topic");
  if (questionTopic) questionTopic.textContent = text;
  if (feedbackTopic) feedbackTopic.textContent = text;

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

function startHostBuzzinJoinTimer(joinEndsAt) {
  stopHostBuzzinJoinTimer();
  const wrap = $("#host-buzzin-timer-wrap");
  const valueEl = $("#host-buzzin-timer");
  if (!wrap || !valueEl || !joinEndsAt) {
    if (wrap) wrap.hidden = true;
    return;
  }

  const tick = () => {
    const remaining = Math.max(0, Math.ceil((joinEndsAt - Date.now()) / 1000));
    valueEl.textContent = String(remaining);
    if (remaining <= 0) stopHostBuzzinJoinTimer();
  };

  wrap.hidden = false;
  tick();
  hostBuzzinJoinTimer = setInterval(tick, 250);
}

function hideHostBuzzinJoinTimer() {
  stopHostBuzzinJoinTimer();
  const wrap = $("#host-buzzin-timer-wrap");
  if (wrap) wrap.hidden = true;
}

function updateHostBuzzinTurnUi(payload) {
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
  let response = responses[0] || null;
  let chatStudent = selectedStudent;
  let chatCurrentTurn = currentTurn;

  if (
    hostBuzzinLuckyStar &&
    currentTurn?.playerId === hostBuzzinLuckyStar.playerId
  ) {
    chatStudent = hostBuzzinLuckyStar;
    chatCurrentTurn = currentTurn;
    response =
      (payload?.responses || []).find(
        (entry) => entry.playerId === hostBuzzinLuckyStar.playerId
      ) || null;
  }

  const isLive = Boolean(chatCurrentTurn && !payload.typingComplete);
  const animate = hostBuzzinFeedbackAnimateFlags(
    payload,
    chatStudent,
    chatCurrentTurn,
    response
  );

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
  renderHostBuzzinFeedbackChat(chatEl, {
    topic: payload.topic,
    student: chatStudent,
    response,
    currentTurn: chatCurrentTurn,
    emptyText: uiT("buzzin.waitingAnswer"),
    animate: {
      topic: animate.topic,
      answer: animate.answer,
      feedback: animate.feedback,
    },
  });
  playNewBuzzinSpokenFeedbackAudio(
    response ? [response] : [],
    hostBuzzinPlayedSpokenFeedbackAudio
  );
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
    showHostBuzzinScreenForPhase(hostBuzzinScreenPhase(payload), { force: true });
  } else {
    setHostBuzzinPrompt(uiT("buzzin.promptNow"));
    startHostBuzzinJoinTimer(payload.joinEndsAt);
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

function startHostBuzzinLuckyDrawScramble(nameEl) {
  stopHostBuzzinLuckyDrawScramble();
  if (!nameEl) return;

  const names = getHostBuzzinLuckyDrawCandidates()
    .map((entry) => entry.displayName)
    .filter(Boolean);
  nameEl.setAttribute("aria-live", "off");
  if (names.length < 2) {
    if (new URLSearchParams(window.location.search).has("preview")) {
      names.push("Sophia Patel", "Liam Chen", "Ava Williams", "Emma Smith", "Noah Brown");
    } else {
      nameEl.textContent = "???";
      return;
    }
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
    else socket.once("connect", run);
  });
}

function buzzinAnswerAnnouncementKey(payload) {
  const announcement = payload?.answerAnnouncement;
  if (!announcement?.playerId) return "";
  return `${payload.roundId || 0}:${announcement.playerId}`;
}

async function playHostBuzzinAnswerAnnouncement({ winner, announcementAudio, announcementAudioFormat } = {}) {
  const turnStatus = $("#host-buzzin-turn-status");
  const winnerName = winner?.displayName || "Student";
  if (turnStatus) {
    turnStatus.textContent = uiT("buzzin.callingOn", { name: winnerName });
    turnStatus.classList.remove("visually-hidden");
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
  if (!key || hostBuzzinPlayedAnnouncements.has(key)) return;
  hostBuzzinPlayedAnnouncements.add(key);

  await playHostBuzzinAnswerAnnouncement({
    winner: {
      playerId: announcement.playerId,
      displayName: announcement.displayName,
    },
    announcementAudio: announcement.audio,
    announcementAudioFormat: announcement.format,
  });
}

async function playHostBuzzinLuckyDraw(winner) {
  const modal = $("#host-buzzin-lucky-draw");
  const wheel = $("#host-buzzin-lucky-draw-wheel");
  const avatar = $("#host-buzzin-lucky-draw-avatar");
  const nameEl = $("#host-buzzin-lucky-draw-name");
  if (!modal || !wheel || !avatar || !nameEl || !winner) return;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const spinMs = reduceMotion ? 0 : 2400;
  const revealHoldMs = reduceMotion ? 600 : 1600;

  resetHostBuzzinLuckyDrawUi();
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  modal.classList.add("is-spinning");
  wheel.classList.add("is-spinning");
  startHostBuzzinLuckyDrawScramble(nameEl);

  if (spinMs > 0) await waitHostBuzzin(spinMs);

  stopHostBuzzinLuckyDrawScramble();
  modal.classList.remove("is-spinning");
  modal.classList.add("is-revealed");
  wheel.classList.remove("is-spinning");
  wheel.classList.add("is-revealed");
  avatar.innerHTML = buzzinLuckyDrawAvatarHtml(winner.displayName);
  nameEl.setAttribute("aria-live", "polite");
  nameEl.textContent = winner.displayName;

  await waitHostBuzzin(revealHoldMs);

  resetHostBuzzinLuckyDrawUi();
}

async function openHostBuzzinLuckyDraw() {
  if (hostBuzzinLuckyDrawRunning) return;
  hostBuzzinLuckyDrawRunning = true;

  const randomBtns = getHostBuzzinRandomButtons();
  randomBtns.forEach((btn) => {
    btn.disabled = true;
  });

  try {
    const result = await requestHostBuzzinLuckyDrawWinner();
    const winner = result?.winner;
    if (!winner) return;

    await playHostBuzzinLuckyDraw(winner);
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
    updateHostBuzzinUi(payload);
    void maybePlayHostBuzzinAnswerAnnouncement(payload);
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
    else socket.once("connect", () => void run());
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
  showScreen("host-quiz-preview", { transition });

  const points = data.points || 300;
  $("#host-quiz-preview-title").textContent = uiT("mcq.questionN", { n: data.questionIndex + 1 });
  $("#host-quiz-preview-points").textContent = uiT("mcq.pts", { n: points });
  $("#host-quiz-preview-question-text").textContent = data.text || "";
  setQuestionImage(
    $("#host-quiz-preview-image"),
    $("#host-quiz-preview-image-wrap"),
    resolvedMediaUrl(data.image)
  );
}

function renderHostQuizSpeaking(data) {
  roomQuizFastMode = !!data.fastMode;
  if (data.fastMode) {
    renderHostQuizQuestion(data, { preparing: true, transition: true });
    clearTimer();
    $("#host-quiz-countdown").textContent = "…";
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
  const screen = $("#screen-host-quiz-question");
  const isFastMode = !!data.fastMode;
  const questionText = data.text || "";
  const questionImageUrl = resolvedMediaUrl(data.image);
  const hasQuestionImage = !!questionImageUrl;
  screen?.classList.toggle("fast-mode", isFastMode);
  screen?.classList.toggle("has-image", hasQuestionImage);
  screen?.classList.toggle("text-short", questionText.length <= 70);
  screen?.classList.toggle("text-medium", questionText.length > 70 && questionText.length <= 150);
  screen?.classList.toggle("text-long", questionText.length > 150);
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
    optionLabels: HOST_MCQ_OPTION_LABELS,
  });
  $("#host-quiz-answered-count").textContent = preparing
    ? uiT("mcq.startingShortly")
    : isFastMode
      ? uiT("fast.quickInProgress")
      : uiT("mcq.studentsAnswering");
  startDeadlineTimer(data.endsAt, data.timeLimit || 5, (remaining) => {
    $("#host-quiz-countdown").textContent = String(Math.max(0, remaining));
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
    const color = HOST_MCQ_OPTION_COLORS[index] || "#94a3b8";
    return `${color} ${start}% ${end}%`;
  });
  if (donut) {
    donut.style.setProperty("--donut-fill", total ? stops.join(", ") : "#d1d5db 0% 100%");
  }

  if (!legend) return;
  legend.innerHTML = options
    .map((option, index) => {
      const label = HOST_MCQ_OPTION_LABELS[index] || `${index + 1}.`;
      const color = HOST_MCQ_OPTION_COLORS[index] || "#94a3b8";
      const count = answerCounts[index] || 0;
      const isCorrect = index === correctIndex;
      const optionText = `${label} ${escapeHtml(option)}`;
      return `<div class="host-mcq-legend-item${isCorrect ? " host-mcq-legend-item--correct" : ""}">
        <span class="host-mcq-legend-label">
          <span class="host-mcq-legend-dot" style="--dot-color: ${color}"></span>
          <span${isCorrect ? ' class="host-mcq-correct-highlight"' : ""}>${optionText}</span>
        </span>
        <strong>${escapeHtml(resultResponseLabel(count))}</strong>
      </div>`;
    })
    .join("");
}

function initialsForName(name) {
  const parts = String(name || "Student").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "S";
}

function renderCorrectResponders(results) {
  const container = $("#host-quiz-correct-responders");
  if (!container) return;
  const correct = (results || []).filter((result) => result.correct).slice(0, 9);
  if (!correct.length) {
    container.innerHTML = `<p class="host-mcq-correct-empty">${uiT("mcq.noCorrectYet")}</p>`;
    return;
  }

  container.innerHTML = correct
    .map((result, index) => {
      const name = String(result.name || "Student").trim() || "Student";
      return `<div class="host-mcq-correct-student" style="--student-i: ${index}">
        <div class="host-mcq-correct-avatar">${escapeHtml(initialsForName(name))}</div>
        <p>${escapeHtml(name)}</p>
      </div>`;
    })
    .join("");
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
    setQuestionImage(
      $("#host-quiz-results-image"),
      $("#host-quiz-results-image-wrap"),
      resolvedMediaUrl(q?.image)
    );
    $("#host-quiz-results-points").textContent = uiT("mcq.pts", { n: points });
    $("#host-quiz-results-question-text").textContent = q?.text || "";
    const correctLabel = HOST_MCQ_OPTION_LABELS[correctIndex] || "";
    const correctAnswerEl = $("#host-quiz-results-correct-answer");
    if (correctAnswerEl) {
      const answerText = `${correctLabel} ${correctAnswer}`.trim();
      const label = uiT("mcq.correctAnswer");
      correctAnswerEl.innerHTML = answerText
        ? `${escapeHtml(label)} <span class="host-mcq-correct-highlight">${escapeHtml(answerText)}</span>`
        : escapeHtml(label);
    }
    $("#host-quiz-results-bars").innerHTML = "";
    renderHostResultDistribution(q, answerCounts, correctIndex);
    renderCorrectResponders(results);
    renderLeaderboard($("#host-quiz-leaderboard"), leaderboard);
    const isLast = q && q.questionIndex + 1 >= q.totalQuestions;
    const nextBtn = $("#btn-host-quiz-next");
    const nextLabel = nextBtn?.querySelector(".host-btn-label") || nextBtn;
    if (nextLabel) {
      nextLabel.textContent = isLast
        ? uiT("quiz.showFinalResults")
        : uiT("quiz.nextQuestion");
    }
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
  const video = $("#host-video-player");
  if (!video) return;
  video.pause();
  setHostVideoSpeedMenuOpen(false);
  setHostVideoLangMenuOpen(false);
  updateHostVideoControls();
}

function showHostVideoExercise(exercise) {
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

  syncHostBuzzinTopic(buzzin.topic, {
    questionIndex: buzzin.questionIndex || 0,
    totalQuestions: buzzin.totalQuestions || buzzin.topics?.length || 1,
    hasNextQuestion: (buzzin.totalQuestions || buzzin.topics?.length || 1) > 1,
  });
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
  if (isBuzzinExercise(exercise)) {
    if (typeof fadeInHostBgm === "function") fadeInHostBgm();
    return showHostBuzzinExercise(exercise, roomId);
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
    }
  });
}

function initHostRoomQuizUi() {
  $("#btn-host-quiz-next")?.addEventListener("click", () => {
    if (typeof playPageNextSound === "function") playPageNextSound();
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
