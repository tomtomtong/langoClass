/** Student MC quiz for Lango room join — syncs via Socket.IO, no question API. */
let roomQuizSocket = null;
let roomQuizPlayerId = null;
let roomQuizCurrentQuestion = null;
let roomQuizJoinTimer = null;
let roomQuizFastMode = false;
let roomBuzzinSocketReady = false;
let roomBuzzinRoundId = null;
let roomBuzzinJoinTimer = null;
let roomBuzzinPcmRecorder = null;
let roomBuzzinRecordTimer = null;
let roomBuzzinRecordEndsAt = 0;
let roomBuzzinRecordStartedAt = 0;
const ROOM_BUZZIN_MAX_RECORD_MS = 30000;
const ROOM_BUZZIN_MIN_RECORD_MS = 600;

function formatRoomBuzzinRecordTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `00 : ${String(seconds).padStart(2, "0")} s`;
}

function stopRoomBuzzinRecordTimer() {
  if (roomBuzzinRecordTimer) {
    clearInterval(roomBuzzinRecordTimer);
    roomBuzzinRecordTimer = null;
  }
}

function setRoomBuzzinRecordingMode(active) {
  const screen = $("#screen-room-buzzin");
  const panel = $("#room-buzzin-recording-panel");
  const timeEl = $("#room-buzzin-recording-time");
  const turnStatus = $("#room-buzzin-turn-status");
  const title = $("#room-buzzin-card-title");

  if (screen) screen.classList.toggle("is-recording", !!active);
  if (panel) panel.hidden = !active;
  if (turnStatus) turnStatus.hidden = !!active;
  if (title) title.textContent = active ? "Recording your voice" : "Record your voice";
  if (timeEl && active) {
    timeEl.textContent = formatRoomBuzzinRecordTime(
      roomBuzzinRecordEndsAt ? roomBuzzinRecordEndsAt - Date.now() : ROOM_BUZZIN_MAX_RECORD_MS
    );
  }
}

function setRoomBuzzinMissedMode(active) {
  const screen = $("#screen-room-buzzin");
  if (screen) screen.classList.toggle("is-missed", !!active);
}

function startRoomBuzzinRecordTimer() {
  stopRoomBuzzinRecordTimer();
  roomBuzzinRecordEndsAt = Date.now() + ROOM_BUZZIN_MAX_RECORD_MS;
  const timeEl = $("#room-buzzin-recording-time");

  const tick = () => {
    const remaining = roomBuzzinRecordEndsAt - Date.now();
    if (timeEl) timeEl.textContent = formatRoomBuzzinRecordTime(remaining);
    if (remaining <= 0) stopRoomBuzzinRecordTimer();
  };

  tick();
  roomBuzzinRecordTimer = setInterval(tick, 250);
}

function cancelRoomBuzzinRecording() {
  roomBuzzinRecordStartedAt = 0;
  if (roomBuzzinPcmRecorder?.cancel) {
    roomBuzzinPcmRecorder.cancel();
  }
  roomBuzzinPcmRecorder = null;
}

function resetRoomBuzzinRecordingUi() {
  cancelRoomBuzzinRecording();
  stopRoomBuzzinRecordTimer();
  roomBuzzinRecordEndsAt = 0;
  setRoomBuzzinRecordingMode(false);
  setRoomBuzzinMissedMode(false);

  const recordBtn = $("#btn-room-buzzin-record");
  const recordStatus = $("#room-buzzin-record-status");
  const turnStatus = $("#room-buzzin-turn-status");
  if (recordBtn) {
    recordBtn.disabled = false;
    recordBtn.textContent = "Record";
    recordBtn.classList.remove("is-recording");
  }
  if (turnStatus) turnStatus.hidden = false;
  if (recordStatus) {
    recordStatus.hidden = true;
    recordStatus.textContent = "";
  }
}

function setRoomBuzzinRecordStatus(message, visible = true) {
  const recordStatus = $("#room-buzzin-record-status");
  if (!recordStatus) return;
  recordStatus.hidden = !visible;
  recordStatus.textContent = message || "";
}

function setRoomBuzzinMissedUi() {
  const topic = $("#room-buzzin-topic");
  const title = $("#room-buzzin-card-title");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  const recordBtn = $("#btn-room-buzzin-record");
  const submitted = $("#room-buzzin-submitted");
  const turnStatus = $("#room-buzzin-turn-status");

  setRoomBuzzinRecordingMode(false);
  setRoomBuzzinMissedMode(true);
  if (topic) topic.textContent = "";
  if (title) title.textContent = "Too late!";
  if (status) status.textContent = "Another student buzzed in first. Please watch the teacher's screen.";
  if (result) {
    result.hidden = true;
    result.textContent = "";
  }
  if (recordBtn) recordBtn.hidden = true;
  if (submitted) submitted.hidden = true;
  if (turnStatus) {
    turnStatus.hidden = false;
    turnStatus.textContent = "Another student buzzed in first. Please watch the teacher's screen.";
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read recording."));
    reader.readAsDataURL(blob);
  });
}

async function startRoomBuzzinRecording() {
  resetRoomBuzzinRecordingUi();
  setRoomBuzzinMissedMode(false);

  roomBuzzinPcmRecorder = createBuzzinPcmRecorder();
  await roomBuzzinPcmRecorder.start();
  roomBuzzinRecordStartedAt = Date.now();
  startRoomBuzzinRecordTimer();
  setRoomBuzzinRecordingMode(true);

  const recordBtn = $("#btn-room-buzzin-record");
  if (recordBtn) {
    recordBtn.textContent = "Stop";
    recordBtn.classList.add("is-recording");
  }
  setRoomBuzzinRecordStatus("", false);

  setTimeout(() => {
    if (roomBuzzinPcmRecorder?.isRecording()) {
      void finishRoomBuzzinRecordingAndSubmit({ timedOut: true });
    }
  }, ROOM_BUZZIN_MAX_RECORD_MS);
}

async function finishRoomBuzzinRecordingAndSubmit({ timedOut = false } = {}) {
  const socket = getRoomSessionSocket();
  const recordBtn = $("#btn-room-buzzin-record");
  const turnStatus = $("#room-buzzin-turn-status");
  const recorder = roomBuzzinPcmRecorder;

  stopRoomBuzzinRecordTimer();
  roomBuzzinRecordEndsAt = 0;
  setRoomBuzzinRecordingMode(false);

  if (recordBtn) {
    recordBtn.textContent = "Record";
    recordBtn.classList.remove("is-recording");
    recordBtn.disabled = true;
  }

  if (!recorder?.isRecording()) {
    setRoomBuzzinRecordStatus("No audio captured. Try recording again.");
    if (turnStatus) turnStatus.textContent = "No audio captured. Try recording again.";
    if (recordBtn) recordBtn.disabled = false;
    return;
  }

  const elapsed = Date.now() - (roomBuzzinRecordStartedAt || Date.now());
  if (elapsed < ROOM_BUZZIN_MIN_RECORD_MS) {
    recorder.cancel();
    roomBuzzinPcmRecorder = null;
    roomBuzzinRecordStartedAt = 0;
    setRoomBuzzinRecordStatus("Hold Record a little longer, then try again.");
    if (turnStatus) turnStatus.textContent = "Hold Record a little longer, then try again.";
    if (recordBtn) recordBtn.disabled = false;
    return;
  }

  setRoomBuzzinRecordStatus(
    timedOut ? "Time limit reached — submitting…" : "Submitting your answer…"
  );
  if (turnStatus) {
    turnStatus.textContent = timedOut
      ? "Time limit reached — submitting your answer…"
      : "Submitting your answer…";
  }

  try {
    const wavBlob = await recorder.stop();
    roomBuzzinPcmRecorder = null;
    roomBuzzinRecordStartedAt = 0;
    setRoomBuzzinRecordStatus("Uploading your answer…");
    const audioBase64 = await blobToWavBase64(wavBlob);
    socket.emit(
      "submit_buzzin_response",
      { audioBase64, format: "wav" },
      (res) => {
        if (!res?.ok) {
          if (recordBtn) recordBtn.disabled = false;
          setRoomBuzzinRecordStatus(res?.error || "Could not submit answer.");
          if (turnStatus) turnStatus.textContent = res?.error || "Could not submit answer.";
          return;
        }
        resetRoomBuzzinRecordingUi();
        updateStudentBuzzinUi(res);
      }
    );
  } catch (err) {
    roomBuzzinPcmRecorder = null;
    roomBuzzinRecordStartedAt = 0;
    if (recordBtn) recordBtn.disabled = false;
    setRoomBuzzinRecordStatus(err.message || "Could not submit answer.");
    if (turnStatus) turnStatus.textContent = err.message || "Could not submit answer.";
  }
}

function stopRoomBuzzinJoinTimer() {
  if (roomBuzzinJoinTimer) {
    clearInterval(roomBuzzinJoinTimer);
    roomBuzzinJoinTimer = null;
  }
}

function startRoomBuzzinJoinTimer(joinEndsAt) {
  stopRoomBuzzinJoinTimer();
  const wrap = $("#room-buzzin-timer-wrap");
  const valueEl = $("#room-buzzin-timer");
  if (!wrap || !valueEl || !joinEndsAt) {
    if (wrap) wrap.hidden = true;
    return;
  }

  const tick = () => {
    const remaining = Math.max(0, Math.ceil((joinEndsAt - Date.now()) / 1000));
    valueEl.textContent = String(remaining);
    if (remaining <= 0) stopRoomBuzzinJoinTimer();
  };

  wrap.hidden = false;
  tick();
  roomBuzzinJoinTimer = setInterval(tick, 250);
}

function hideRoomBuzzinJoinTimer() {
  stopRoomBuzzinJoinTimer();
  const wrap = $("#room-buzzin-timer-wrap");
  if (wrap) wrap.hidden = true;
}

function resetRoomBuzzinTurnUi() {
  const turnArea = $("#room-buzzin-turn");
  const submitted = $("#room-buzzin-submitted");
  const turnStatus = $("#room-buzzin-turn-status");
  const title = $("#room-buzzin-card-title");

  resetRoomBuzzinRecordingUi();
  if (title) title.textContent = "Record your voice";
  const recordBtn = $("#btn-room-buzzin-record");
  if (turnArea) turnArea.hidden = true;
  if (recordBtn) {
    recordBtn.hidden = true;
    recordBtn.disabled = true;
  }
  if (submitted) {
    submitted.hidden = true;
    submitted.textContent = "";
  }
  if (turnStatus) turnStatus.textContent = "";
}

function updateStudentBuzzinTurnUi(payload) {
  const phase = payload.phase || "join";
  const turnArea = $("#room-buzzin-turn");
  const turnStatus = $("#room-buzzin-turn-status");
  const submitted = $("#room-buzzin-submitted");
  const playerId = roomParticipant?.userId;
  const myBuzz = (payload.buzzes || []).find((b) => b.playerId === playerId);
  const myResponse = (payload.responses || []).find((r) => r.playerId === playerId);
  const currentTurn = payload.currentTurn || null;
  const firstBuzz = (payload.buzzes || [])[0] || null;
  const isMyAnswerTurn =
    currentTurn?.playerId === playerId ||
    (!currentTurn && firstBuzz?.playerId === playerId);

  if (phase === "ready" || phase === "join") {
    resetRoomBuzzinTurnUi();
    return;
  }

  if (!turnArea || !turnStatus) return;
  turnArea.hidden = false;
  hideRoomBuzzinJoinTimer();

  if (!myBuzz) {
    setRoomBuzzinMissedUi();
    return;
  }

  if (myResponse) {
    turnStatus.textContent = "Your answer was submitted.";
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) recordBtn.hidden = true;
    if (submitted) {
      submitted.hidden = false;
      submitted.textContent = "Your answer was submitted.";
    }
    return;
  }

  if (payload.typingComplete) {
    turnStatus.textContent = "Buzz round complete.";
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) recordBtn.hidden = true;
    return;
  }

  if (isMyAnswerTurn) {
    turnStatus.textContent = "You buzzed in — tap Record and speak your answer.";
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) {
      recordBtn.hidden = false;
      recordBtn.disabled = false;
    }
    if (submitted) submitted.hidden = true;
    return;
  }

  setRoomBuzzinMissedUi();
}

function updateStudentBuzzinUi(payload) {
  const btn = $("#btn-room-buzz-in");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  if (!btn || !status) return;

  const phase = payload.phase || (payload.status === "full" ? "join" : payload.status === "closed" ? "typing" : "join");
  const playerId = roomParticipant?.userId;
  const myBuzz = (payload.buzzes || []).find((b) => b.playerId === playerId);
  const currentTurn = payload.currentTurn || null;
  const firstBuzz = (payload.buzzes || [])[0] || null;
  const alreadyWon = (payload.ineligiblePlayerIds || []).includes(playerId);
  const isMyAnswerTurn =
    currentTurn?.playerId === playerId ||
    (!currentTurn && firstBuzz?.playerId === playerId);
  const joinClosed = phase !== "join" && phase !== "ready";

  if (phase === "ready") {
    btn.hidden = false;
    btn.disabled = true;
    hideRoomBuzzinJoinTimer();
    resetRoomBuzzinTurnUi();
    status.textContent = alreadyWon
      ? "You already won 300 points in this exercise."
      : "Waiting for teacher to start…";
    result.hidden = true;
    return;
  }

  if (phase === "join") {
    btn.hidden = false;
    startRoomBuzzinJoinTimer(payload.joinEndsAt);
    resetRoomBuzzinTurnUi();
  } else {
    btn.hidden = true;
    hideRoomBuzzinJoinTimer();
    updateStudentBuzzinTurnUi(payload);
  }

  if (alreadyWon) {
    btn.disabled = true;
    status.textContent = "You already won 300 points — let another student try!";
    result.hidden = false;
    result.textContent = "300 points secured!";
    result.className = "buzzin-result buzzin-result--selected";
    return;
  }

  if (myBuzz && isMyAnswerTurn) {
    btn.disabled = true;
    result.hidden = false;
    result.textContent = "You buzzed in!";
    result.className = "buzzin-result buzzin-result--selected";
    if (joinClosed) {
      status.textContent = phase === "typing"
        ? "You buzzed in — tap Record when ready."
        : "Buzz in closed.";
    } else {
      status.textContent = "You buzzed in!";
    }
    return;
  }

  if (myBuzz && !isMyAnswerTurn) {
    btn.disabled = true;
    setRoomBuzzinMissedUi();
    return;
  }

  if (joinClosed) {
    btn.disabled = true;
    if (phase === "done") {
      status.textContent = "Buzz round complete.";
      result.hidden = true;
    } else {
      setRoomBuzzinMissedUi();
    }
    return;
  }

  btn.disabled = false;
  status.textContent = "Tap BUZZ IN — one student can answer!";
  result.hidden = true;
}

function resetStudentBuzzinUi() {
  roomBuzzinRoundId = null;
  stopRoomBuzzinJoinTimer();
  resetRoomBuzzinTurnUi();
  const btn = $("#btn-room-buzz-in");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  if (btn) {
    btn.hidden = false;
    btn.disabled = true;
  }
  const title = $("#room-buzzin-card-title");
  if (title) title.textContent = "Record your voice";
  if (status) status.textContent = "Waiting for teacher to start…";
  if (result) {
    result.hidden = true;
    result.textContent = "";
  }
  hideRoomBuzzinJoinTimer();
}

function ensureRoomBuzzinSocket() {
  const socket = getRoomSessionSocket();
  if (roomBuzzinSocketReady) return socket;

  roomBuzzinSocketReady = true;

  socket.on("buzzin_round_started", (payload) => {
    roomBuzzinRoundId = payload.roundId;
    resetStudentBuzzinUi();
    updateStudentBuzzinUi(payload);
  });

  socket.on("buzzin_join_opened", (payload) => {
    if (payload.roundId != null) roomBuzzinRoundId = payload.roundId;
    updateStudentBuzzinUi(payload);
  });

  socket.on("buzzin_update", (payload) => {
    if (payload.roundId != null && roomBuzzinRoundId == null) {
      roomBuzzinRoundId = payload.roundId;
    }
    updateStudentBuzzinUi(payload);
  });

  socket.on("buzzin_join_closed", (payload) => {
    if (payload.roundId != null && roomBuzzinRoundId == null) {
      roomBuzzinRoundId = payload.roundId;
    }
    updateStudentBuzzinUi(payload);
  });

  $("#btn-room-buzz-in")?.addEventListener("click", () => {
    const btn = $("#btn-room-buzz-in");
    if (!btn || btn.disabled) return;
    btn.disabled = true;

    socket.emit("buzz_in", {}, (res) => {
      if (!res?.ok) {
        btn.disabled = false;
        const status = $("#room-buzzin-status");
        if (status) status.textContent = res?.error || "Could not buzz in.";
        return;
      }

      const result = $("#room-buzzin-result");
      const status = $("#room-buzzin-status");
      if (result) {
        result.hidden = false;
        result.textContent = "You buzzed in!";
        result.className = "buzzin-result buzzin-result--selected";
      }
      if (status) {
        status.textContent = "You buzzed in! Get ready to answer…";
      }
    });
  });

  $("#btn-room-buzzin-record")?.addEventListener("click", async () => {
    const recordBtn = $("#btn-room-buzzin-record");
    const turnStatus = $("#room-buzzin-turn-status");
    if (!recordBtn || recordBtn.disabled) return;

    if (roomBuzzinPcmRecorder?.isRecording()) {
      await finishRoomBuzzinRecordingAndSubmit();
      return;
    }

    try {
      recordBtn.disabled = true;
      await startRoomBuzzinRecording();
      recordBtn.disabled = false;
    } catch (err) {
      recordBtn.disabled = false;
      setRoomBuzzinRecordStatus(err.message || "Could not access microphone.");
      if (turnStatus) turnStatus.textContent = err.message || "Could not access microphone.";
    }
  });

  return socket;
}

function syncStudentBuzzinState(roomId) {
  const socket = ensureRoomBuzzinSocket();
  if (!roomId) return;

  const applyState = (payload) => {
    if (!payload?.active) {
      resetStudentBuzzinUi();
      return;
    }
    roomBuzzinRoundId = payload.roundId;
    updateStudentBuzzinUi(payload);
  };

  const requestState = () => {
    socket.emit("get_buzzin_state", { roomId }, (res) => {
      if (res?.ok) applyState(res);
    });
  };

  if (socket.connected) requestState();
  else socket.once("connect", requestState);
}

function startStudentBuzzinRound(roomId) {
  ensureRoomBuzzinSocket();
  syncStudentBuzzinState(roomId);
}

function stopRoomQuizJoinRetry() {
  if (roomQuizJoinTimer) {
    clearInterval(roomQuizJoinTimer);
    roomQuizJoinTimer = null;
  }
}

function setupRoomPlayerQuiz(socket) {
  socket.on("game_starting", ({ fastMode } = {}) => {
    roomQuizFastMode = !!fastMode;
    if (roomQuizFastMode) window.roomFastQuizCompleted = false;
    $("#room-waiting-status").textContent = "Get ready…";
  });

  socket.on("question_preview", (data) => {
    stopRoomStatusPoll();
    stopRoomQuizJoinRetry();
    roomQuizCurrentQuestion = data;
    clearTimer();
    resetPlayerMcqAnsweredState();
    showScreen("player-question");

    const screen = $("#screen-player-question");
    screen?.classList.add("is-previewing");
    $("#player-mcq-title").textContent = `Question ${data.questionIndex + 1}`;
    $("#player-q-meta").textContent = "Read the question";
    setQuestionImage(
      $("#player-question-image"),
      $("#player-question-image-wrap"),
      typeof resolvedMediaUrl === "function" ? resolvedMediaUrl(data.image) : data.image
    );
    $("#player-question-text").textContent = data.text || "";
    $("#player-options").innerHTML = "";
    $("#answer-feedback").textContent = "Get ready to answer…";

    startDeadlineTimer(
      data.previewEndsAt,
      data.previewSeconds || 5,
      (remaining) => {
        $("#timer-text").textContent = remaining;
        $("#timer-ring").classList.toggle("urgent", remaining <= 1);
      }
    );
  });

  socket.on("question_start", (data) => {
    stopRoomStatusPoll();
    stopRoomQuizJoinRetry();
    roomQuizCurrentQuestion = data;
    if (data?.fastMode != null) roomQuizFastMode = !!data.fastMode;
    clearTimer();
    resetPlayerMcqAnsweredState();
    showScreen("player-question");
    $("#screen-player-question")?.classList.remove("is-previewing");
    $("#player-mcq-title").textContent = "MCQ Question";
    $("#player-q-meta").textContent =
      `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
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
        $("#answer-feedback").textContent = "Answer locked in!";
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
        $("#answer-feedback").textContent = "Time's up!";
      }
    );
  });

  socket.on("answer_received", () => {
    $("#answer-feedback").textContent = roomQuizFastMode
      ? "Answer saved — next question coming…"
      : "Waiting for others…";
  });

  socket.on("question_between", ({ isLast } = {}) => {
    if (!roomQuizFastMode) return;
    clearTimer();
    $("#answer-feedback").textContent = isLast
      ? "Calculating your score…"
      : "Next question coming…";
  });

  socket.on("question_results", ({ results, leaderboard }) => {
    if (roomQuizFastMode) return;
    clearTimer();
    showScreen("player-results");
    const mine = results.find((r) => r.playerId === roomQuizPlayerId);
    renderPlayerMcqResult(mine, leaderboard, roomQuizPlayerId);
  });

  socket.on("game_finished", ({ leaderboard, semesterLeaderboard, exerciseLeaderboard, answerReview, answerHistory }) => {
    const wasFastMode = roomQuizFastMode;
    roomQuizFastMode = false;
    clearTimer();
    if (wasFastMode) {
      window.roomFastQuizCompleted = true;
      showScreen("player-fast-results");
      if (typeof renderPlayerFastMcResult === "function") {
        renderPlayerFastMcResult({
          answerReview,
          answerHistory,
          leaderboard: exerciseLeaderboard || leaderboard,
          playerId: roomQuizPlayerId,
        });
      }
      return;
    }
    showScreen("player-finished");
    showExerciseLeaderboards({
      exerciseLeaderboard: exerciseLeaderboard || leaderboard,
      semesterLeaderboard,
      highlightId: roomQuizPlayerId,
      exerciseListEl: $("#player-final-leaderboard"),
      semesterListEl: $("#player-semester-leaderboard"),
      semesterWrapEl: $("#player-semester-leaderboard-wrap"),
      exerciseWrapEl: $("#player-exercise-leaderboard-wrap"),
    });
    const playBtn = $("#btn-play-again");
    if (playBtn) playBtn.hidden = true;
  });

  socket.on("game_ended", () => {
    clearTimer();
    location.href = roomJoinUrl({
      roomId: roomParticipant?.roomId || "",
      token: roomParticipant?.userId || urlToken || "",
      name: roomParticipant?.displayName || "",
    });
  });
}

function tryJoinRoomQuiz(roomId, displayName, userId) {
  if (!roomQuizSocket) {
    roomQuizSocket = io({ transports: ["websocket", "polling"] });
    setupRoomPlayerQuiz(roomQuizSocket);
  }

  const attempt = () => {
    if (!roomQuizSocket.connected) return;

    roomQuizSocket.emit(
      "join_room_game",
      { roomId, nickname: displayName, userId },
      (res) => {
        if (!res?.ok) return;
        roomQuizPlayerId = res.playerId;
        stopRoomQuizJoinRetry();
        $("#room-waiting-status").textContent = "You're in — waiting for the next question…";
      }
    );
  };

  if (roomQuizSocket.connected) attempt();
  else roomQuizSocket.once("connect", attempt);

  stopRoomQuizJoinRetry();
  roomQuizJoinTimer = setInterval(attempt, 2500);
}

function showStudentVideoExercise(exercisePayload) {
  stopRoomStatusPoll();
  stopRoomQuizJoinRetry();

  const exercise = exerciseFromSessionRecord(exercisePayload);
  const title = exercise?.title || "Watch the lesson";

  $("#room-passive-waiting-title").textContent = title;
  $("#room-passive-waiting-status").textContent =
    "No action is needed. Please watch the teacher's screen.";
  showScreen("room-passive-waiting");
}

function showStudentBuzzinExercise(exercisePayload) {
  stopRoomStatusPoll();
  stopRoomQuizJoinRetry();

  const exercise = exerciseFromSessionRecord(exercisePayload);
  const buzzin = buzzinFromExercise(exercise);
  if (!buzzin) return;

  $("#room-buzzin-topic").textContent = buzzin.topic;
  resetStudentBuzzinUi();
  showScreen("room-buzzin");
  startStudentBuzzinRound(roomParticipant?.roomId);
}

function startRoomExercise(roomId, displayName, userId, exercisePayload) {
  const exercise = exerciseFromSessionRecord(exercisePayload);
  if (!exercise) return;
  if (isLiveMcQuizExercise(exercise)) {
    connectRoomQuiz(roomId, displayName, userId);
    return;
  }
  if (isVideoExercise(exercise)) {
    showStudentVideoExercise(exercisePayload);
    return;
  }
  if (isBuzzinExercise(exercise)) {
    showStudentBuzzinExercise(exercisePayload);
  }
}

let roomParticipant = null;

function connectRoomQuiz(roomId, displayName, userId) {
  roomParticipant = { roomId, displayName, userId };
  tryJoinRoomQuiz(roomId, displayName, userId);
}
