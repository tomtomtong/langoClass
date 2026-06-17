/** Student MC quiz for Lango room join — syncs via Socket.IO, no question API. */
let roomQuizSocket = null;
let roomQuizPlayerId = null;
let roomQuizCurrentQuestion = null;
let roomQuizJoinTimer = null;
let roomQuizFastMode = false;
let roomBuzzinSocketReady = false;
let roomBuzzinRoundId = null;
let roomBuzzinJoinTimer = null;

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
  const answer = $("#room-buzzin-answer");
  const submitBtn = $("#btn-room-buzzin-submit");
  const submitted = $("#room-buzzin-submitted");
  const turnStatus = $("#room-buzzin-turn-status");

  if (turnArea) turnArea.hidden = true;
  if (answer) {
    answer.value = "";
    answer.disabled = true;
    answer.hidden = true;
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.hidden = true;
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
  const answer = $("#room-buzzin-answer");
  const submitBtn = $("#btn-room-buzzin-submit");
  const submitted = $("#room-buzzin-submitted");
  const playerId = roomParticipant?.userId;
  const myBuzz = (payload.buzzes || []).find((b) => b.playerId === playerId);
  const myResponse = (payload.responses || []).find((r) => r.playerId === playerId);
  const currentTurn = payload.currentTurn || null;

  if (phase === "join") {
    resetRoomBuzzinTurnUi();
    return;
  }

  if (!turnArea || !turnStatus) return;
  turnArea.hidden = false;
  hideRoomBuzzinJoinTimer();

  if (!myBuzz) {
    turnStatus.textContent = "Buzz in closed. You did not buzz in time.";
    if (answer) answer.hidden = true;
    if (submitBtn) submitBtn.hidden = true;
    if (submitted) submitted.hidden = true;
    return;
  }

  if (myResponse) {
    turnStatus.textContent = `You answered (#${myResponse.rank}). Waiting for others…`;
    if (answer) answer.hidden = true;
    if (submitBtn) submitBtn.hidden = true;
    if (submitted) {
      submitted.hidden = false;
      submitted.textContent = myResponse.text;
    }
    return;
  }

  if (payload.typingComplete) {
    turnStatus.textContent = "All answers submitted.";
    if (answer) answer.hidden = true;
    if (submitBtn) submitBtn.hidden = true;
    return;
  }

  if (currentTurn?.playerId === playerId) {
    turnStatus.textContent = `You're #${myBuzz.rank} — type your answer now.`;
    if (answer) {
      answer.hidden = false;
      answer.disabled = false;
    }
    if (submitBtn) {
      submitBtn.hidden = false;
      submitBtn.disabled = false;
    }
    if (submitted) submitted.hidden = true;
    return;
  }

  const waitingFor = currentTurn?.displayName || "another student";
  turnStatus.textContent = `You're #${myBuzz.rank}. Waiting for ${waitingFor} (#${currentTurn?.rank || "?"})…`;
  if (answer) answer.hidden = true;
  if (submitBtn) submitBtn.hidden = true;
  if (submitted) submitted.hidden = true;
}

function updateStudentBuzzinUi(payload) {
  const btn = $("#btn-room-buzz-in");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  if (!btn || !status) return;

  const phase = payload.phase || (payload.status === "full" ? "join" : payload.status === "closed" ? "typing" : "join");
  const playerId = roomParticipant?.userId;
  const myBuzz = (payload.buzzes || []).find((b) => b.playerId === playerId);
  const joinClosed = phase !== "join";

  if (phase === "join") {
    startRoomBuzzinJoinTimer(payload.joinEndsAt);
    resetRoomBuzzinTurnUi();
  } else {
    hideRoomBuzzinJoinTimer();
    updateStudentBuzzinTurnUi(payload);
  }

  if (myBuzz) {
    btn.disabled = true;
    result.hidden = false;
    result.textContent = `You buzzed in #${myBuzz.rank}.`;
    result.className = "buzzin-result buzzin-result--selected";
    if (joinClosed) {
      status.textContent = joinClosed && phase === "typing"
        ? "Buzz in closed — answer in turn order."
        : "Buzz in closed.";
    } else {
      status.textContent = `You're in at #${myBuzz.rank}. Keep waiting…`;
    }
    return;
  }

  if (joinClosed) {
    btn.disabled = true;
    status.textContent = phase === "done"
      ? "Buzz round complete."
      : "Buzz in closed — you did not buzz in time.";
    result.hidden = true;
    return;
  }

  btn.disabled = false;
  status.textContent = "Tap BUZZ IN before time runs out!";
  result.hidden = true;
}

function resetStudentBuzzinUi() {
  roomBuzzinRoundId = null;
  stopRoomBuzzinJoinTimer();
  resetRoomBuzzinTurnUi();
  const btn = $("#btn-room-buzz-in");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Get ready to buzz in…";
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
        result.textContent = `You buzzed in #${res.rank}!`;
        result.className = "buzzin-result buzzin-result--selected";
      }
      if (status) {
        status.textContent = `You're in at #${res.rank}! Wait for the buzz window to close…`;
      }
    });
  });

  $("#btn-room-buzzin-submit")?.addEventListener("click", () => {
    const answer = $("#room-buzzin-answer");
    const submitBtn = $("#btn-room-buzzin-submit");
    if (!answer || !submitBtn || submitBtn.disabled) return;

    const text = answer.value.trim();
    if (!text) {
      const turnStatus = $("#room-buzzin-turn-status");
      if (turnStatus) turnStatus.textContent = "Type your answer before submitting.";
      return;
    }

    submitBtn.disabled = true;
    answer.disabled = true;

    socket.emit("submit_buzzin_response", { text }, (res) => {
      if (!res?.ok) {
        submitBtn.disabled = false;
        answer.disabled = false;
        const turnStatus = $("#room-buzzin-turn-status");
        if (turnStatus) turnStatus.textContent = res?.error || "Could not submit answer.";
        return;
      }
      updateStudentBuzzinUi(res);
    });
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
    $("#room-waiting-status").textContent = "Get ready…";
  });

  socket.on("question_start", (data) => {
    stopRoomStatusPoll();
    stopRoomQuizJoinRetry();
    roomQuizCurrentQuestion = data;
    clearTimer();
    showScreen("player-question");
    $("#player-q-meta").textContent =
      `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
    setQuestionImage($("#player-question-image"), $("#player-question-image-wrap"), null);
    $("#player-question-text").textContent = data.text;
    $("#answer-feedback").textContent = "";

    renderOptions($("#player-options"), data.options, {
      clickable: true,
      onClick: (index, btn) => {
        $("#player-options").querySelectorAll(".player-btn").forEach((b) => (b.disabled = true));
        btn.classList.add("selected");
        socket.emit("submit_answer", { answerIndex: index });
        $("#answer-feedback").textContent = "Answer locked in!";
        clearTimer();
      },
    });

    startTimer(
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
    const msg = $("#player-result-msg");
    if (mine?.correct) {
      msg.textContent = `Correct! +${mine.points} points`;
      msg.className = "result-msg correct";
    } else if (mine?.answerIndex != null) {
      msg.textContent = "Wrong answer";
      msg.className = "result-msg wrong";
    } else {
      msg.textContent = "No answer submitted";
      msg.className = "result-msg wrong";
    }
    renderLeaderboard($("#player-leaderboard"), leaderboard, roomQuizPlayerId);
  });

  socket.on("game_finished", ({ leaderboard, semesterLeaderboard, exerciseLeaderboard }) => {
    roomQuizFastMode = false;
    clearTimer();
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
    const backBtn = $("#btn-back-room-waiting");
    const playBtn = $("#btn-play-again");
    if (backBtn) backBtn.hidden = false;
    if (playBtn) playBtn.hidden = true;
  });

  socket.on("game_ended", ({ reason }) => {
    clearTimer();
    alert(reason || "Class ended");
    location.href = `/join.html?room=${encodeURIComponent(roomParticipant?.roomId || "")}`;
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

  $("#room-waiting-status").textContent = "Watch the lesson on the teacher's screen.";
  showScreen("room-waiting");
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
