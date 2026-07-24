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
let hostBuzzinLuckyStar = null;
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
    ? `${response.analysisStatus || "none"}:${response.analysis || ""}:${response.spokenFeedback || ""}`
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

function syncHostBuzzinTopic(topic) {
  const text = String(topic || "").trim();
  const questionTopic = $("#host-buzzin-topic");
  const feedbackTopic = $("#host-buzzin-feedback-topic");
  if (questionTopic) questionTopic.textContent = text;
  if (feedbackTopic) feedbackTopic.textContent = text;
}

function hostBuzzinShowFeedbackPhase(payload) {
  const phase = payload?.phase || "join";
  if (phase === "ready" || phase === "join") return false;
  return true;
}

function showHostBuzzinScreenForPhase(phase, { force = false } = {}) {
  const normalized = phase === "join" ? "join" : "feedback";
  const screenId = normalized === "join" ? "host-buzzin" : "host-buzzin-feedback";
  const domActive = document.querySelector(`#screen-${screenId}.active`);
  if (!force && hostBuzzinActiveScreenPhase === normalized && domActive) return;
  hostBuzzinActiveScreenPhase = normalized;
  if (typeof showScreen !== "function") return;
  showScreen(screenId, { transition: false });
  if (normalized === "feedback") triggerHostBuzzinFeedbackEnter();
}

function triggerHostBuzzinFeedbackEnter() {
  const screen = $("#screen-host-buzzin-feedback");
  if (!screen) return;
  screen.classList.remove("host-buzzin-feedback-screen--enter");
  void screen.offsetWidth;
  screen.classList.add("host-buzzin-feedback-screen--enter");
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
    if (turnStatus) turnStatus.textContent = "No one buzzed in.";
    if (!hostBuzzinLuckyStar) {
      setHostBuzzinLeaderboardMode("winner");
      renderHostBuzzinWinnerCard(winnerEl, null, payload);
    }
    renderHostBuzzinFeedbackChat(chatEl, {
      topic: payload.topic,
      emptyText: "No answer yet.",
    });
    return;
  }

  if (payload.typingComplete) {
    if (turnStatus) turnStatus.textContent = `${chatStudent?.displayName || selectedStudent?.displayName || "Student"} has answered.`;
  } else if (chatCurrentTurn) {
    if (turnStatus) turnStatus.textContent = `Waiting for ${chatCurrentTurn.displayName} to record their answer…`;
  } else {
    if (turnStatus) turnStatus.textContent = `Waiting for ${(chatStudent || selectedStudent)?.displayName || "Student"} to answer…`;
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
    emptyText: "Waiting for answer…",
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
  if (payload.topic) syncHostBuzzinTopic(payload.topic);

  const joinStatus = $("#host-buzzin-join-status");

  if (phase === "ready") {
    hideHostBuzzinJoinTimer();
    setHostBuzzinStartButtonVisible(true);
    setHostBuzzinPrompt("Get ready");
    if (joinStatus) {
      joinStatus.textContent = hostBuzzinTopicSpeaking
        ? "Uncle Tommy is reading the question…"
        : "Tap Get Ready when students are ready.";
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
      : `One student can buzz in — ${payload.joinSecondsRemaining ?? 20}s left`;
  }

  if (showFeedback) {
    hideHostBuzzinJoinTimer();
    setHostBuzzinPrompt("Buzz In Now");
    showHostBuzzinScreenForPhase("feedback", { force: true });
  } else {
    setHostBuzzinPrompt("Buzz In Now");
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
    title.textContent = "Our lucky Students";
    sub.textContent = "Today's Lucky Star";
    return;
  }

  title.textContent = "Fastest Student";
  sub.textContent = "Buzz In Winner";
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

function resetHostBuzzinLuckyDrawUi() {
  const modal = $("#host-buzzin-lucky-draw");
  const wheel = $("#host-buzzin-lucky-draw-wheel");
  const avatar = $("#host-buzzin-lucky-draw-avatar");
  const nameEl = $("#host-buzzin-lucky-draw-name");

  if (modal) {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("is-spinning", "is-revealed");
  }
  if (wheel) wheel.classList.remove("is-spinning", "is-revealed");
  if (avatar) avatar.innerHTML = "";
  if (nameEl) nameEl.textContent = "????????";
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
    turnStatus.textContent = `Uncle Tommy is calling on ${winnerName}…`;
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
      turnStatus.textContent = `Waiting for ${winnerName} to record their answer…`;
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
  nameEl.textContent = "????????";

  if (spinMs > 0) await waitHostBuzzin(spinMs);

  modal.classList.remove("is-spinning");
  modal.classList.add("is-revealed");
  wheel.classList.remove("is-spinning");
  wheel.classList.add("is-revealed");
  avatar.innerHTML = buzzinLuckyDrawAvatarHtml(winner.displayName);
  nameEl.textContent = winner.displayName;

  await waitHostBuzzin(revealHoldMs);

  resetHostBuzzinLuckyDrawUi();
}

async function openHostBuzzinLuckyDraw() {
  if (hostBuzzinLuckyDrawRunning) return;
  hostBuzzinLuckyDrawRunning = true;

  const randomBtn = $("#btn-host-buzzin-random");
  if (randomBtn) randomBtn.disabled = true;

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
    if (randomBtn) randomBtn.disabled = false;
  }
}

function bindHostBuzzinSocketHandlers(socket) {
  if (socket.__hostBuzzinBound) return;
  socket.__hostBuzzinBound = true;

  const applyBuzzinPayload = (payload) => {
    if (payload?.roundId != null) hostBuzzinRoundId = payload.roundId;
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
  setHostBuzzinPrompt("Get ready");
  showHostBuzzinScreenForPhase("join", { force: true });

  const joinStatus = $("#host-buzzin-join-status");
  if (joinStatus) joinStatus.textContent = "Uncle Tommy is reading the question…";

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
          if (joinStatus) joinStatus.textContent = "Uncle Tommy is reading the question…";
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
              if (joinStatus) joinStatus.textContent = "Tap Get Ready when students are ready.";
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
  if (startBtn) startBtn.disabled = true;
  if (joinStatus) joinStatus.textContent = "Starting…";

  if (!socket.connected) {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", () => reject(new Error("Could not connect to room.")));
    });
  }

  try {
    await new Promise((resolve, reject) => {
      socket.emit("start_buzzin_countdown", { roomId: hostBuzzinRoomId }, (res) => {
        if (!res?.ok) {
          reject(new Error(res?.error || "Could not start buzz-in countdown."));
          return;
        }
        resolve();
      });
    });

    if (typeof playExerciseCountdownVideo === "function") {
      await playExerciseCountdownVideo();
    } else if (typeof playCountdown321Video === "function") {
      await playCountdown321Video({
        root: document.querySelector("#app.lango-host") || document.body,
        layerClass: "host-exercise-countdown",
        videoClass: "host-exercise-countdown-video",
        playingClass: "is-playing",
      });
    }
  } catch (err) {
    if (startBtn) startBtn.disabled = false;
    if (joinStatus) joinStatus.textContent = err.message || "Could not start buzz in.";
    throw err;
  }

  return new Promise((resolve, reject) => {
    socket.emit("open_buzzin_join", { roomId: hostBuzzinRoomId }, (res) => {
      if (!res?.ok) {
        if (startBtn) startBtn.disabled = false;
        if (joinStatus) joinStatus.textContent = res?.error || "Could not start buzz in.";
        reject(new Error(res?.error || "Could not start buzz in."));
        return;
      }
      updateHostBuzzinUi(res);
      resolve();
    });
  });
}

function getRoomQuizSocket() {
  if (!roomQuizSocket) {
    roomQuizSocket = io({ transports: ["websocket", "polling"] });
    setupHostRoomQuizSocket(roomQuizSocket);
  }
  return roomQuizSocket;
}

function renderHostQuizPreview(data) {
  roomQuizCurrentQuestion = data;
  clearTimer();
  showScreen("host-quiz-preview");

  const points = data.points || 300;
  $("#host-quiz-preview-title").textContent = `Question ${data.questionIndex + 1}`;
  $("#host-quiz-preview-points").textContent = `${points} pts`;
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
    $("#host-quiz-answered-count").textContent = "Uncle Tommy is reading the question…";
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
    ? "Get ready…"
    : `Question ${data.questionIndex + 1}`;
  $("#host-quiz-points").textContent = `${points} pts`;
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
    ? "Starting shortly…"
    : isFastMode
      ? "Quick answers in progress…"
      : "Students are answering…";
  startDeadlineTimer(data.endsAt, data.timeLimit || 5, (remaining) => {
    $("#host-quiz-countdown").textContent = String(Math.max(0, remaining));
  });
}

function resultResponseLabel(count) {
  return `${count} Response${count === 1 ? "" : "s"}`;
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
  donut.style.setProperty("--donut-fill", total ? stops.join(", ") : "#d1d5db 0% 100%");

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
        <strong>${count} <span>Response${count === 1 ? "" : "s"}</span></strong>
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
  const correct = (results || []).filter((result) => result.correct).slice(0, 9);
  if (!correct.length) {
    container.innerHTML = `<p class="host-mcq-correct-empty">No correct responses yet</p>`;
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
  if (!container) return;

  const groups = new Map();
  (results || []).forEach((student) => {
    const count = Math.max(0, Number(student.correctAnswers) || 0);
    if (!groups.has(count)) groups.set(count, []);
    groups.get(count).push(student);
  });

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => b - a);
  if (!sortedGroups.length) {
    container.innerHTML = '<p class="host-fast-result-empty">No responses yet</p>';
    return;
  }

  let studentIndex = 0;
  container.innerHTML = sortedGroups
    .map(([correctAnswers, students]) => {
      const calculatedPercent = totalQuestions
        ? Math.round((correctAnswers / totalQuestions) * 100)
        : 0;
      const accuracyPercent = Math.max(
        0,
        Math.min(100, Number(students[0]?.accuracyPercent) || calculatedPercent)
      );
      const cards = students.map((student) => {
        const name = String(student.name || "Student").trim() || "Student";
        const index = studentIndex++;
        return `<article class="host-fast-result-student">
          <span class="host-fast-result-avatar" style="--student-i:${index}" aria-hidden="true">${escapeHtml(initialsForName(name))}</span>
          <span class="host-fast-result-name">${escapeHtml(name)}</span>
        </article>`;
      }).join("");

      return `<section class="host-fast-result-group${students.length > 3 ? " is-expanded" : ""}">
        <h3 class="host-fast-result-score" aria-label="${accuracyPercent}% accuracy, ${correctAnswers} correct"><strong>${accuracyPercent}%</strong><span>accuracy</span></h3>
        <div class="host-fast-result-students">${cards}</div>
      </section>`;
    })
    .join("");
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
      ? "Calculating final results…"
      : "Next question coming…";
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
    $("#host-quiz-results-points").textContent = `${points} pts`;
    $("#host-quiz-results-question-text").textContent = q?.text || "";
    const correctLabel = HOST_MCQ_OPTION_LABELS[correctIndex] || "";
    const correctAnswerEl = $("#host-quiz-results-correct-answer");
    if (correctAnswerEl) {
      const answerText = `${correctLabel} ${correctAnswer}`.trim();
      correctAnswerEl.innerHTML = answerText
        ? `Correct Answer: <span class="host-mcq-correct-highlight">${escapeHtml(answerText)}</span>`
        : "Correct Answer:";
    }
    $("#host-quiz-results-bars").innerHTML = "";
    renderHostResultDistribution(q, answerCounts, correctIndex);
    renderCorrectResponders(results);
    renderLeaderboard($("#host-quiz-leaderboard"), leaderboard);
    const isLast = q && q.questionIndex + 1 >= q.totalQuestions;
    $("#btn-host-quiz-next").textContent = isLast ? "Show final results" : "Next question";
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
      exerciseListEl: $("#host-quiz-final-leaderboard"),
      semesterListEl: $("#host-semester-leaderboard"),
      semesterWrapEl: $("#host-semester-leaderboard-wrap"),
      exerciseWrapEl: $("#host-exercise-leaderboard-wrap"),
    });
    if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  });

  socket.on("game_ended", ({ reason }) => {
    alert(reason || "Quiz ended");
  });
}

let hostVideoControlsReady = false;
let hostVideoScrubbing = false;
let hostVideoControlsHideTimer = null;

function setHostVideoControlsVisible(visible, { autoHide = false } = {}) {
  const screen = $("#screen-host-video");
  const video = $("#host-video-player");
  if (!screen || !video) return;

  if (hostVideoControlsHideTimer) {
    clearTimeout(hostVideoControlsHideTimer);
    hostVideoControlsHideTimer = null;
  }

  screen.classList.toggle("controls-visible", visible);
  if (visible && autoHide && !video.paused && !video.ended && !hostVideoScrubbing) {
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
  if (play) play.setAttribute("aria-label", video.paused ? "Play video" : "Pause video");
  if (mute) mute.setAttribute("aria-label", video.muted || video.volume === 0 ? "Unmute video" : "Mute video");
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

  video.addEventListener("play", () => {
    if (typeof fadeOutHostBgm === "function") fadeOutHostBgm();
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
    if (!video.paused && !video.ended && !hostVideoScrubbing) {
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

  ["loadedmetadata", "durationchange", "timeupdate", "play", "pause", "ended", "volumechange"].forEach((eventName) => {
    video.addEventListener(eventName, updateHostVideoControls);
  });
}

function resetHostVideoControls() {
  const scrubber = $("#host-video-scrubber");
  hostVideoScrubbing = false;
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
  video.src = url;
  video.load();
  setupHostVideoControls();
  resetHostVideoControls();
  $("#screen-host-video")?.classList.add("has-video");
  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  if (typeof fadeOutHostBgm === "function") fadeOutHostBgm();
  showScreen("host-video");
}

function showHostBuzzinExercise(exercise, roomId) {
  const buzzin = buzzinFromExercise(exercise);
  if (!buzzin) throw new Error("No Buzz In content in this exercise.");

  syncHostBuzzinTopic(buzzin.topic);
  const points = typeof exercisePointsValue === "function" ? exercisePointsValue(exercise) : 300;
  hostBuzzinExercisePoints = points;
  const pointsEl = $("#host-buzzin-points");
  if (pointsEl) {
    pointsEl.textContent = `${points} pts`;
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

  $("#btn-host-buzzin-random")?.addEventListener("click", () => {
    if (typeof playPageNextSound === "function") playPageNextSound();
    void openHostBuzzinLuckyDraw();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHostRoomQuizUi);
} else {
  initHostRoomQuizUi();
}
