const ROOM_STORAGE_KEY = window.LANGO_VARIANT === "hk-elderly"
  ? "lango_join_participant_hk"
  : "lango_join_participant";

const urlParams = new URLSearchParams(window.location.search);
const urlRoom = (urlParams.get("room") || urlParams.get("roomId") || "").trim();
const urlPin = urlParams.get("pin");
const urlToken = (
  urlParams.get("token") ||
  urlParams.get("studentId") ||
  urlParams.get("userId") ||
  ""
).trim();
const urlNickname = (
  urlParams.get("nickname") ||
  urlParams.get("username") ||
  urlParams.get("name") ||
  urlParams.get("displayName") ||
  ""
).trim();

function resolveStudentUserId(roomId, stored) {
  if (urlToken) return urlToken;
  if (stored?.roomId === roomId && stored.userId) return stored.userId;
  return undefined;
}

function resolveDisplayName(roomId, stored) {
  if (urlNickname) return urlNickname.slice(0, 40);
  if (stored?.roomId === roomId && stored.displayName) {
    return String(stored.displayName).trim().slice(0, 40);
  }
  return "";
}

function roomJoinUrl({ roomId = "", token = "", name = "" } = {}) {
  const url = new URL(langoJoinPagePath(), window.location.origin);
  if (roomId) url.searchParams.set("room", roomId);
  if (token) url.searchParams.set("token", token);
  if (name) url.searchParams.set("name", name);
  return `${url.pathname}${url.search}`;
}

function loadStoredParticipant() {
  try {
    return JSON.parse(localStorage.getItem(ROOM_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveStoredParticipant(data) {
  localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(data));
}

function clearStoredParticipant() {
  localStorage.removeItem(ROOM_STORAGE_KEY);
}

let roomSessionSocket = null;
let joinSessionLocale = "en";
const FAST_RESULT_OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];
let joinWaitingStatusKey = "join.waitingStatus";
let joinLastMcqResult = null;
let joinLastFastResult = null;
let joinLastLeaderboard = null;
let joinLastBuzzinPayload = null;
const JOIN_ENDED_STORAGE_KEY = "lango_join_ended";
let joinEndedStatusKey = "join.endedStatus";
let lastJoinDisplayName = urlNickname.slice(0, 40);

function isClosedRoomJoinError(data) {
  const code = data?.errorCode;
  if (code === "room_not_found" || code === "session_ended") return true;
  const msg = String(data?.error || "");
  return /room not found/i.test(msg) || /session has ended/i.test(msg);
}

function isOnEndedScreen() {
  return $("#screen-room-ended")?.classList.contains("active");
}

function setJoinEndedError(text) {
  const el = $("#join-ended-error");
  if (el) el.textContent = text || "";
}

function setEndedSubmitBusy(busy) {
  const btn = $("#btn-join-ended");
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = busy ? joinT("join.joiningRoom") : joinT("join.rejoin");
}

function persistJoinEndedState() {
  try {
    sessionStorage.setItem(
      JOIN_ENDED_STORAGE_KEY,
      JSON.stringify({
        name: lastJoinDisplayName,
        statusKey: joinEndedStatusKey,
      })
    );
  } catch {
    /* private mode / quota */
  }
}

function loadJoinEndedState() {
  try {
    return JSON.parse(sessionStorage.getItem(JOIN_ENDED_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function clearJoinEndedState() {
  try {
    sessionStorage.removeItem(JOIN_ENDED_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function stripDeadRoomFromUrl() {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete("room");
  nextUrl.searchParams.delete("roomId");
  nextUrl.searchParams.delete("token");
  nextUrl.searchParams.delete("studentId");
  nextUrl.searchParams.delete("userId");
  history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}`);
}

function teardownJoinSockets() {
  if (typeof stopRoomQuizJoinRetry === "function") stopRoomQuizJoinRetry();
  if (roomSessionSocket) {
    roomSessionSocket.disconnect();
    roomSessionSocket = null;
  }
  if (typeof roomQuizSocket !== "undefined" && roomQuizSocket) {
    roomQuizSocket.disconnect();
    roomQuizSocket = null;
  }
  if (typeof roomBuzzinSocketReady !== "undefined") {
    roomBuzzinSocketReady = false;
  }
}

function rememberJoinDisplayName(name) {
  const next = String(name || "").trim().slice(0, 40);
  if (next) lastJoinDisplayName = next;
}

function showClassEnded({ statusKey = "join.endedStatus" } = {}) {
  joinEndedStatusKey = statusKey || "join.endedStatus";
  rememberJoinDisplayName(
    roomParticipant?.displayName || urlNickname || lastJoinDisplayName
  );
  if (typeof stopRoomStatusPoll === "function") stopRoomStatusPoll();
  if (typeof clearTimer === "function") clearTimer();
  if (typeof resetStudentBuzzinUi === "function") resetStudentBuzzinUi();
  teardownJoinSockets();
  clearStoredParticipant();
  roomParticipant = null;
  persistJoinEndedState();
  stripDeadRoomFromUrl();
  wireJoinEndedForm();

  const status = $("#room-ended-status");
  if (status) status.textContent = joinT(joinEndedStatusKey);

  const codeInput = $("#join-ended-code");
  if (codeInput) codeInput.value = "";
  setJoinEndedError("");
  setEndedSubmitBusy(false);

  showScreen("room-ended");
  requestAnimationFrame(() => codeInput?.focus());
}

function wireJoinEndedForm() {
  const form = $("#join-ended-form");
  const codeInput = $("#join-ended-code");
  if (!form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";

  codeInput?.addEventListener("input", () => {
    const digits = normalizePin(codeInput.value);
    codeInput.value = formatRoomCode(digits);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = normalizePin(codeInput?.value);
    const name = String(lastJoinDisplayName || urlNickname || "").trim().slice(0, 40);
    setJoinEndedError("");

    if (code.length !== 6) {
      setJoinEndedError(joinT("join.invalidRoomCode"));
      codeInput?.focus();
      return;
    }
    if (!name) {
      setJoinEndedError(joinT("join.nameMissingAsk"));
      return;
    }

    rememberJoinDisplayName(name);
    persistJoinEndedState();
    if (urlParams.has("preview") || document.body.classList.contains("join-preview-mode")) {
      setJoinEndedError(joinT("join.previewJoinDisabled"));
      return;
    }
    void doJoinRoom(code, name);
  });
}

function joinT(key, vars) {
  return window.LangoI18n?.t?.(key, vars) ?? key;
}

function showPlayerLateJoinWelcome(displayName) {
  const toast = $("#player-join-welcome");
  const copyEl = $("#player-join-welcome-copy");
  const name = String(displayName || "").trim() || joinT("join.button");
  if (!toast || !copyEl) return;

  copyEl.textContent = joinT("join.youreIn", { name });
  toast.hidden = false;
  toast.setAttribute("aria-hidden", "false");
  if (window.LangoGsap?.playPlayerJoinWelcome) {
    window.LangoGsap.playPlayerJoinWelcome(toast);
    return;
  }
  window.setTimeout(() => {
    toast.hidden = true;
    toast.setAttribute("aria-hidden", "true");
  }, 1200);
}

function rememberLateJoinWelcome(roomId, userId) {
  const key = `lango_late_join_welcome:${roomId}:${userId || "anon"}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

function applyJoinUiLocale(locale, { persist = false } = {}) {
  const i18n = window.LangoI18n;
  if (!i18n || !locale) return;
  joinSessionLocale = i18n.setLocale(locale, { persist, apply: true });
  refreshJoinLocalizedUi();
}

function setJoinWaitingStatus(key) {
  joinWaitingStatusKey = key || "join.waitingStatus";
  const el = $("#room-waiting-status");
  if (el) el.textContent = joinT(joinWaitingStatusKey);
}

function refreshJoinLocalizedUi() {
  const activeId = document.querySelector(".screen.active")?.id || "";

  const waitingStatus = $("#room-waiting-status");
  if (waitingStatus && joinWaitingStatusKey) {
    waitingStatus.textContent = joinT(joinWaitingStatusKey);
  }

  const passiveTitle = $("#room-passive-waiting-title");
  const passiveStatus = $("#room-passive-waiting-status");
  if (activeId === "screen-room-passive-waiting") {
    if (passiveTitle && !passiveTitle.dataset.customTitle) {
      passiveTitle.textContent = joinT("join.watchTitle");
    }
    if (passiveStatus) passiveStatus.textContent = joinT("join.watchStatus");
  }

  if (activeId === "screen-player-results" && joinLastMcqResult && typeof renderPlayerMcqResult === "function") {
    renderPlayerMcqResult(
      joinLastMcqResult.mine,
      joinLastMcqResult.leaderboard,
      joinLastMcqResult.playerId
    );
  }

  if (activeId === "screen-player-fast-results" && joinLastFastResult && typeof renderPlayerFastMcResult === "function") {
    renderPlayerFastMcResult(joinLastFastResult);
  }

  if (activeId === "screen-player-finished" && joinLastLeaderboard && typeof showExerciseLeaderboards === "function") {
    showExerciseLeaderboards(joinLastLeaderboard);
    const playBtn = $("#btn-play-again");
    if (playBtn) playBtn.hidden = true;
  }

  if (activeId === "screen-room-buzzin" && joinLastBuzzinPayload && typeof updateStudentBuzzinUi === "function") {
    updateStudentBuzzinUi(joinLastBuzzinPayload);
  }

  if (activeId === "screen-room-ended") {
    const endedStatus = $("#room-ended-status");
    if (endedStatus) endedStatus.textContent = joinT(joinEndedStatusKey);
    const endedBtn = $("#btn-join-ended");
    if (endedBtn && !endedBtn.disabled) endedBtn.textContent = joinT("join.rejoin");
  }

  if (activeId === "screen-player-question") {
    const label = $("#player-selected-answer-label");
    if (label && !label.hidden) label.textContent = joinT("mcq.selectedAnswer");
  }
}

function showPlayerPassiveWaiting({
  title = joinT("join.watchTitle"),
  message = joinT("join.watchStatus"),
} = {}) {
  const titleEl = $("#room-passive-waiting-title");
  const statusEl = $("#room-passive-waiting-status");
  if (titleEl) {
    titleEl.textContent = title;
    if (title && title !== joinT("join.watchTitle")) titleEl.dataset.customTitle = "1";
    else delete titleEl.dataset.customTitle;
  }
  if (statusEl) statusEl.textContent = message;
  showScreen("room-passive-waiting");
}

function answerHistoryForPlayer(answerHistory, playerId) {
  return (answerHistory || []).map((questionAnswers) =>
    (questionAnswers || []).find((entry) => entry.playerId === playerId) || null
  );
}

function renderPlayerFastMcResult({
  answerReview = [],
  answerHistory = [],
  leaderboard = [],
  playerId,
} = {}) {
  const rows = Array.isArray(answerReview) ? answerReview : [];
  const mineByQuestion = answerHistoryForPlayer(answerHistory, playerId);
  const correctCount = mineByQuestion.filter((entry) => entry?.correct).length;
  const scoreRow = (leaderboard || []).find((row) => row.id === playerId || row.playerId === playerId);

  $("#player-fast-correct-score").dataset.correctCount = String(correctCount);
  $("#player-fast-correct-score").dataset.total = String(rows.length);
  $("#player-fast-current-points").dataset.scoreValue = String(scoreRow?.score || 0);
  $("#player-fast-correct-score").textContent = `${correctCount} / ${rows.length}`;
  $("#player-fast-current-points").textContent = uiT("mcq.pts", { n: scoreRow?.score || 0 });

  const list = $("#player-fast-answer-list");
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = `<li class="player-leaderboard__empty">${uiT("fast.noReview")}</li>`;
    window.requestAnimationFrame?.(() => {
      window.LangoGsap?.playPlayerFastResultEnter?.(
        document.querySelector("#screen-player-fast-results")
      );
    });
    return;
  }

  list.innerHTML = rows
    .map((question, index) => {
      const correctIndex = Number(question.correctIndex);
      const correctLabel = FAST_RESULT_OPTION_LABELS[correctIndex] || "";
      const mine = mineByQuestion[index];
      const answerIndex = mine?.answerIndex;
      const answerLabel =
        answerIndex == null ? "-" : FAST_RESULT_OPTION_LABELS[Number(answerIndex)] || "-";
      const answerText =
        question.correctAnswer ||
        (Array.isArray(question.options) ? question.options[correctIndex] : "") ||
        uiT("fast.correctAnswer");
      const answered = answerIndex != null;
      const isCorrect = Boolean(mine?.correct);
      const resultClass = isCorrect ? "is-correct" : answered ? "is-incorrect" : "is-unanswered";
      const resultLabel = isCorrect
        ? uiT("fast.statusCorrect")
        : answered
          ? uiT("fast.statusIncorrect")
          : uiT("fast.statusNoAnswer");
      const selectedText = answered
        ? (Array.isArray(question.options) ? question.options[Number(answerIndex)] : "") || `Option ${answerLabel}`
        : uiT("fast.noAnswerSubmitted");
      const answerLines = isCorrect
        ? `<div class="player-fast-result__answer-line player-fast-result__answer-line--correct">
            <span class="player-fast-result__answer-label">${uiT("fast.yourAnswerCorrect")}</span>
            <span class="player-fast-result__answer-value"><strong>${escapeHtml(correctLabel)}.</strong> ${escapeHtml(answerText)}</span>
          </div>`
        : `<div class="player-fast-result__answer-line player-fast-result__answer-line--correct">
            <span class="player-fast-result__answer-label">${uiT("fast.correctAnswer")}</span>
            <span class="player-fast-result__answer-value"><strong>${escapeHtml(correctLabel)}.</strong> ${escapeHtml(answerText)}</span>
          </div>
          <div class="player-fast-result__answer-line player-fast-result__answer-line--yours">
            <span class="player-fast-result__answer-label">${uiT("fast.yourAnswer")}</span>
            <span class="player-fast-result__answer-value">${answered ? `<strong>${escapeHtml(answerLabel)}.</strong> ` : ""}${escapeHtml(selectedText)}</span>
          </div>`;

      return `<li class="player-fast-result__answer ${resultClass}">
        <div class="player-fast-result__answer-head">
          <span class="player-fast-result__answer-number">${uiT("fast.questionN", { n: index + 1 })}</span>
          <span class="player-fast-result__answer-status">${resultLabel}</span>
        </div>
        ${answerLines}
      </li>`;
    })
    .join("");

  window.requestAnimationFrame?.(() => {
    window.LangoGsap?.playPlayerFastResultEnter?.(
      document.querySelector("#screen-player-fast-results")
    );
  });
}

function getRoomSessionSocket() {
  if (!roomSessionSocket) {
    roomSessionSocket = io({ transports: ["websocket", "polling"] });

    roomSessionSocket.on("session_locale", ({ uiLocale }) => {
      if (uiLocale) applyJoinUiLocale(uiLocale);
    });

    roomSessionSocket.on("session_lobby_update", (data) => {
      if (data?.uiLocale) applyJoinUiLocale(data.uiLocale);
    });

    roomSessionSocket.on("session_started", ({ exercise }) => {
      if (!roomParticipant) return;
      window.roomFastQuizCompleted = false;
      setJoinWaitingStatus("join.classStarting");
      startRoomExercise(
        roomParticipant.roomId,
        roomParticipant.displayName,
        roomParticipant.userId,
        exercise
      );
    });

    roomSessionSocket.on("session_ended", () => {
      showClassEnded({ statusKey: "join.endedStatus" });
    });

    roomSessionSocket.on("room_exercise_wrap_up", (payload) => {
      if (!roomParticipant) return;

      if (window.roomFastQuizCompleted) {
        if ($("#screen-player-fast-results")?.classList.contains("active")) return;
        showPlayerPassiveWaiting();
        return;
      }

      const hasScores =
        (payload?.exerciseLeaderboard || []).length > 0 ||
        (payload?.semesterLeaderboard || []).length > 0;

      if (hasScores) {
        showScreen("player-finished");
        joinLastLeaderboard = {
          exerciseLeaderboard: payload.exerciseLeaderboard,
          semesterLeaderboard: payload.semesterLeaderboard,
          highlightId: roomParticipant.userId,
          exerciseListEl: $("#player-final-leaderboard"),
          semesterListEl: $("#player-semester-leaderboard"),
          semesterWrapEl: $("#player-semester-leaderboard-wrap"),
          exerciseWrapEl: $("#player-exercise-leaderboard-wrap"),
        };
        showExerciseLeaderboards(joinLastLeaderboard);
        const playBtn = $("#btn-play-again");
        if (playBtn) playBtn.hidden = true;
        return;
      }

      setJoinWaitingStatus("join.inClassWaiting");
      showScreen("room-waiting");
    });
  }
  return roomSessionSocket;
}

function stopRoomStatusPoll() {
  /* Session status is pushed over Socket.IO — no polling. */
}

function startRoomStatusPoll() {
  /* Session status is pushed over Socket.IO — no polling. */
}

function showRoomJoinPanels({ showNameForm = false, showJoining = false } = {}) {
  $("#join-panel-quiz").hidden = true;
  $("#join-panel-link-required").hidden = true;
  $("#join-panel-room-name").hidden = !showNameForm;
  $("#join-panel-room").hidden = !showJoining;
}

function wireRoomNameForm() {
  const formBtn = $("#btn-join-room-name");
  const nameInput = $("#join-room-name");
  if (!formBtn || formBtn.dataset.wired === "1") return;
  formBtn.dataset.wired = "1";

  const submitName = () => {
    const roomId = normalizePin(urlRoom || loadStoredParticipant()?.roomId || "");
    const name = nameInput?.value.trim().slice(0, 40) || "";
    const errorEl = $("#join-room-name-error");
    if (!roomId) {
      if (errorEl) errorEl.textContent = joinT("join.classHint");
      return;
    }
    if (!name) {
      if (errorEl) errorEl.textContent = joinT("join.enterNickname");
      nameInput?.focus();
      return;
    }
    if (errorEl) errorEl.textContent = "";
    rememberJoinDisplayName(name);
    showRoomJoinPanels({ showJoining: true });
    void doJoinRoom(roomId, name);
  };

  formBtn.addEventListener("click", submitName);
  nameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitName();
    }
  });
}

function initRoomNameForm(roomId) {
  showRoomJoinPanels({ showNameForm: true });
  wireRoomNameForm();

  const nameInput = $("#join-room-name");
  const errorEl = $("#join-room-name-error");
  if (errorEl) errorEl.textContent = "";
  if (nameInput) {
    nameInput.value = String(lastJoinDisplayName || urlNickname || "").trim().slice(0, 40);
    requestAnimationFrame(() => nameInput.focus());
  }
}

function initRoomJoin() {
  showRoomJoinPanels({ showJoining: true });

  const stored = loadStoredParticipant();
  const activeRoom = normalizePin(urlRoom || stored?.roomId || "");
  if (stored?.roomId && (urlRoom === stored.roomId || !urlRoom)) {
    roomParticipant = stored;
    if (urlToken) roomParticipant.userId = urlToken;
  }

  $("#btn-leave-room").addEventListener("click", () => {
    stopRoomStatusPoll();
    stopRoomQuizJoinRetry();
    if (roomSessionSocket) roomSessionSocket.disconnect();
    roomSessionSocket = null;
    showClassEnded({ statusKey: "join.endedStatus" });
  });

  if (!activeRoom) {
    showRoomJoinPanels({ showJoining: true });
    $("#join-room-status").textContent = "";
    $("#join-room-error").textContent = joinT("join.classHint");
    return;
  }

  const displayName = resolveDisplayName(activeRoom, stored);
  if (!displayName) {
    initRoomNameForm(activeRoom);
    return;
  }

  void doJoinRoom(activeRoom, displayName);
}

function doJoinRoom(roomId, displayNameOverride) {
  const stored = loadStoredParticipant();
  const displayName = (displayNameOverride || resolveDisplayName(roomId, stored)).trim();
  const fromEnded = isOnEndedScreen();
  if (!fromEnded) {
    showRoomJoinPanels({ showJoining: true });
  }
  if (fromEnded) {
    setJoinEndedError("");
    setEndedSubmitBusy(true);
  } else {
    $("#join-room-error").textContent = "";
    $("#join-room-status").textContent = joinT("join.joiningRoom");
  }

  const failJoin = (message) => {
    if (fromEnded || isOnEndedScreen()) {
      setEndedSubmitBusy(false);
      setJoinEndedError(message);
    } else {
      if ($("#join-panel-room-name") && !$("#join-panel-room-name").hidden) {
        showRoomJoinPanels({ showNameForm: true });
        const nameError = $("#join-room-name-error");
        if (nameError) nameError.textContent = message;
        return;
      }
      $("#join-room-status").textContent = "";
      $("#join-room-error").textContent = message;
    }
  };

  if (!roomId) {
    failJoin(joinT("join.classHint"));
    return;
  }
  if (!displayName) {
    failJoin(joinT("join.nameMissing"));
    return;
  }

  const socket = getRoomSessionSocket();

  const attemptJoin = () => {
    socket.emit(
      "join_session",
      {
        roomId,
        displayName,
        userId: resolveStudentUserId(roomId, stored),
      },
      (data) => {
        if (!data?.ok) {
          const closed = isClosedRoomJoinError(data);
          const statusKey =
            data.errorCode === "session_ended" ? "join.endedStatus" : "join.roomGone";
          if (closed && (fromEnded || isOnEndedScreen())) {
            failJoin(joinT(statusKey));
            return;
          }
          if (closed) {
            showClassEnded({ statusKey });
            return;
          }
          failJoin(data?.error || joinT("join.failedRoom"));
          return;
        }

        const participant = {
          roomId: data.roomId,
          userId: data.userId,
          displayName: data.displayName,
        };
        saveStoredParticipant(participant);
        roomParticipant = participant;
        rememberJoinDisplayName(participant.displayName);
        clearJoinEndedState();
        setEndedSubmitBusy(false);

        if (data.uiLocale) applyJoinUiLocale(data.uiLocale);

        setJoinWaitingStatus(
          data.sessionStatus === "start" ? "join.classStarting" : "join.inClassWaiting"
        );
        showScreen("room-waiting");
        if (
          data.sessionStatus === "start" &&
          rememberLateJoinWelcome(data.roomId, data.userId)
        ) {
          showPlayerLateJoinWelcome(participant.displayName);
        }

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("room", data.roomId);
        nextUrl.searchParams.delete("roomId");
        if (data.userId) nextUrl.searchParams.set("token", data.userId);
        else nextUrl.searchParams.delete("token");
        if (data.displayName) nextUrl.searchParams.set("name", data.displayName);
        else nextUrl.searchParams.delete("name");
        nextUrl.searchParams.delete("nickname");
        nextUrl.searchParams.delete("username");
        nextUrl.searchParams.delete("displayName");
        history.replaceState(null, "", nextUrl);
      }
    );
  };

  if (socket.connected) attemptJoin();
  else {
    socket.once("connect", attemptJoin);
    socket.once("connect_error", () => {
      failJoin(joinT("join.connectFail"));
    });
  }
}

function initQuizJoin() {
  const pin = normalizePin(urlPin || "");
  if (pin.length !== 6) {
    $("#join-panel-quiz").hidden = true;
    $("#join-panel-room-name").hidden = true;
    $("#join-panel-link-required").hidden = false;
    return;
  }

  const socket = io({ transports: ["websocket", "polling"] });
  let myPlayerId = null;
  let currentQuestion = null;
  let quizFastMode = false;

  const statusEl = $("#connection-status");
  const joinBtn = $("#btn-join-game");

  function setConnectionStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = `connection-status${type ? ` ${type}` : ""}`;
  }

  function updateJoinButton() {
    joinBtn.disabled = !socket.connected;
  }

  socket.on("connect", () => {
    setConnectionStatus(joinT("join.connectedEnter"), "ok");
    updateJoinButton();
  });

  socket.on("disconnect", () => {
    setConnectionStatus(joinT("join.reconnecting"), "err");
    updateJoinButton();
  });

  socket.on("connect_error", () => {
    setConnectionStatus(joinT("join.cannotReach"), "err");
    updateJoinButton();
  });

  function doJoin() {
    const nickname = $("#join-nickname").value.trim();
    $("#join-error").textContent = "";

    if (!nickname) {
      $("#join-error").textContent = joinT("join.enterNickname");
      return;
    }

    joinBtn.disabled = true;

    socket.emit("join_game", { pin, nickname }, (res) => {
      joinBtn.disabled = !socket.connected;

      if (!res?.ok) {
        let msg = res?.error || joinT("join.failedGame");
        if (res?.hint) msg += ` ${res.hint}`;
        $("#join-error").textContent = msg;
        return;
      }

      myPlayerId = res.playerId;
      $("#room-waiting-title").textContent = res.quizTitle || joinT("join.waitingTitle");
      setJoinWaitingStatus("status.waitHost");
      $("#btn-leave-room").hidden = true;
      showScreen("room-waiting");
    });
  }

  joinBtn.addEventListener("click", () => {
    if (!socket.connected) {
      $("#join-error").textContent = joinT("join.stillConnecting");
      return;
    }
    doJoin();
  });

  socket.on("game_starting", ({ fastMode } = {}) => {
    quizFastMode = !!fastMode;
    setJoinWaitingStatus("status.getReady");
  });

  socket.on("question_speaking", (data) => {
    currentQuestion = data;
    if (data?.fastMode != null) quizFastMode = !!data.fastMode;
    clearTimer();
    resetPlayerMcqAnsweredState();
    showScreen("player-question");
    $("#screen-player-question")?.classList.add("is-previewing");
    $("#player-q-meta").textContent = uiT("mcq.listenQuestion");
    setQuestionImage(
      $("#player-question-image"),
      $("#player-question-image-wrap"),
      typeof resolvedMediaUrl === "function" ? resolvedMediaUrl(data.image) : data.image
    );
    $("#player-question-text").textContent = data.text || "";
    $("#player-options").innerHTML = "";
    $("#answer-feedback").textContent = uiT("buzzin.uncleReading");
    $("#timer-text").textContent = "…";
    $("#timer-ring")?.classList.remove("urgent");
  });

  socket.on("question_start", (data) => {
    currentQuestion = data;
    if (data?.fastMode != null) quizFastMode = !!data.fastMode;
    clearTimer();
    resetPlayerMcqAnsweredState();
    showScreen("player-question");
    $("#screen-player-question")?.classList.remove("is-previewing");
    $("#player-q-meta").textContent = uiT("mcq.questionOf", { n: data.questionIndex + 1, total: data.totalQuestions });
    setQuestionImage(
      $("#player-question-image"),
      $("#player-question-image-wrap"),
      typeof resolvedMediaUrl === "function" ? resolvedMediaUrl(data.image) : data.image
    );
    $("#player-question-text").textContent = data.text;
    $("#answer-feedback").textContent = "";

    renderOptions($("#player-options"), data.options, {
      clickable: true,
      optionLabels: ["A.", "B.", "C.", "D.", "E.", "F."],
      onClick: (index, btn) => {
        showPlayerMcqAnsweredState(index);
        socket.emit("submit_answer", { answerIndex: index });
        $("#answer-feedback").textContent = uiT("mcq.answerLocked");
      },
    });

    startDeadlineTimer(
      data.endsAt,
      data.timeLimit,
      (remaining) => {
        $("#timer-text").textContent = remaining;
        $("#timer-ring").classList.toggle("urgent", remaining <= 5);
      },
      () => {
        $("#player-options").querySelectorAll(".player-btn").forEach((b) => (b.disabled = true));
        $("#answer-feedback").textContent = uiT("mcq.timesUp");
      }
    );
  });

  socket.on("answer_received", () => {
    $("#answer-feedback").textContent = quizFastMode
      ? uiT("fast.answerSaved")
      : uiT("mcq.waitingOthers");
  });

  socket.on("question_between", ({ isLast } = {}) => {
    if (!quizFastMode) return;
    clearTimer();
    $("#answer-feedback").textContent = isLast
      ? uiT("mcq.calculatingScore")
      : uiT("mcq.nextComing");
  });

  socket.on("question_results", ({ results, leaderboard }) => {
    if (quizFastMode) return;
    clearTimer();
    showScreen("player-results");
    const mine = results.find((r) => r.playerId === myPlayerId);
    renderPlayerMcqResult(mine, leaderboard, myPlayerId);
  });

  socket.on("game_finished", ({ leaderboard, semesterLeaderboard, exerciseLeaderboard, answerReview, answerHistory, accuracyLeaderboard }) => {
    const wasFastMode = quizFastMode;
    quizFastMode = false;
    clearTimer();
    if (wasFastMode) {
      showScreen("player-fast-results");
      const fastPayload = {
        answerReview,
        answerHistory,
        leaderboard: exerciseLeaderboard || leaderboard,
        playerId: myPlayerId,
      };
      joinLastFastResult = fastPayload;
      renderPlayerFastMcResult(fastPayload);
      return;
    }
    showScreen("player-finished");
    showExerciseLeaderboards({
      exerciseLeaderboard: exerciseLeaderboard || leaderboard,
      semesterLeaderboard,
      accuracyLeaderboard,
      totalQuestions: answerReview?.length || 0,
      highlightId: myPlayerId,
      exerciseListEl: $("#player-final-leaderboard"),
      semesterListEl: $("#player-semester-leaderboard"),
      semesterWrapEl: $("#player-semester-leaderboard-wrap"),
      exerciseWrapEl: $("#player-exercise-leaderboard-wrap"),
    });
    const playBtn = $("#btn-play-again");
    if (playBtn) playBtn.hidden = false;
  });

  socket.on("game_ended", () => {
    clearTimer();
    location.href = langoJoinPagePath();
  });

  if (urlNickname) $("#join-nickname").value = urlNickname.slice(0, 20);

  $("#btn-play-again")?.addEventListener("click", () => {
    location.href = langoJoinPagePath();
  });

  updateJoinButton();

  if (urlNickname && socket.connected) doJoin();
  else if (urlNickname) socket.once("connect", doJoin);
}

function initJoinLinkRequired() {
  $("#join-panel-quiz").hidden = true;
  $("#join-panel-room").hidden = true;
  $("#join-panel-room-name").hidden = true;
  $("#join-panel-link-required").hidden = false;
}

window.LangoI18n?.init?.(isHkElderlyVariant() ? { locale: "yue" } : undefined);
window.LangoI18n?.applyDom?.();
wireJoinEndedForm();

function bindPlayAgain() {
  $("#btn-play-again")?.addEventListener("click", () => {
    location.href = langoJoinPagePath();
  });
}

if (urlParams.has("preview")) {
  /* Layout preview mode — join-preview.js drives the UI. */
} else if (urlPin) {
  initQuizJoin();
} else if (urlRoom || loadStoredParticipant()?.roomId) {
  initRoomJoin();
  bindPlayAgain();
} else {
  const endedState = loadJoinEndedState();
  if (endedState) {
    if (endedState.name) lastJoinDisplayName = endedState.name;
    showClassEnded({ statusKey: endedState.statusKey || "join.endedStatus" });
  } else if (urlToken || urlNickname) {
    initRoomJoin();
    bindPlayAgain();
  } else {
    initJoinLinkRequired();
  }
}

window.LangoI18n?.onChange?.(() => {
  refreshJoinLocalizedUi();
});