/** Student MC quiz for Lango room join — syncs via Socket.IO, no question API. */
let roomQuizSocket = null;
let roomQuizPlayerId = null;
let roomQuizCurrentQuestion = null;
let roomQuizJoinTimer = null;
let roomQuizFastMode = false;
let roomBuzzinSocketReady = false;
let roomBuzzinRoundId = null;

function updateStudentBuzzinUi(payload) {
  const btn = $("#btn-room-buzz-in");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  if (!btn || !status) return;

  const playerId = roomParticipant?.userId;
  const myBuzz = (payload.buzzes || []).find((b) => b.playerId === playerId);
  const winnersFull = payload.status === "full";

  if (myBuzz) {
    btn.disabled = true;
    result.hidden = false;
    if (myBuzz.rank <= (payload.winnerCount || 3)) {
      result.textContent =
        myBuzz.rank === 1
          ? "You're first — selected to talk!"
          : `You're #${myBuzz.rank} — selected to talk!`;
      result.className = "buzzin-result buzzin-result--selected";
    } else {
      result.textContent = `You buzzed in #${myBuzz.rank}. The fastest 3 were already selected.`;
      result.className = "buzzin-result buzzin-result--late";
    }
    status.textContent = winnersFull
      ? "Buzz in closed — fastest 3 selected."
      : `You're in at #${myBuzz.rank}. Waiting for others…`;
    return;
  }

  if (winnersFull) {
    btn.disabled = true;
    status.textContent = "Buzz in closed — fastest 3 selected.";
    result.hidden = true;
    return;
  }

  btn.disabled = false;
  status.textContent = "Tap BUZZ IN when you want to answer the topic!";
  result.hidden = true;
}

function resetStudentBuzzinUi() {
  roomBuzzinRoundId = null;
  const btn = $("#btn-room-buzz-in");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Get ready to buzz in…";
  if (result) {
    result.hidden = true;
    result.textContent = "";
  }
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
        if (res.selected) {
          result.textContent =
            res.rank === 1
              ? "You're first — selected to talk!"
              : `You're #${res.rank} — selected to talk!`;
          result.className = "buzzin-result buzzin-result--selected";
        } else {
          result.textContent = `You buzzed in #${res.rank}. The fastest 3 were already selected.`;
          result.className = "buzzin-result buzzin-result--late";
        }
      }
      if (status) {
        status.textContent = res.selected
          ? `You're in at #${res.rank}!`
          : "Buzz in closed for top 3.";
      }
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

  $("#room-buzzin-title").textContent = buzzin.title;
  $("#room-buzzin-buddy").textContent = buddyDisplayText(buzzin.buddy);
  $("#room-buzzin-questions").innerHTML = renderBuzzinQuestionList(buzzin.questions);
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
