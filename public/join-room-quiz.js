/** Student MC quiz for Lango room join — syncs via Socket.IO, no question API. */
let roomQuizSocket = null;
let roomQuizPlayerId = null;
let roomQuizCurrentQuestion = null;
let roomQuizJoinTimer = null;
let roomQuizFastMode = false;

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

  socket.on("game_finished", ({ leaderboard }) => {
    roomQuizFastMode = false;
    clearTimer();
    showScreen("player-finished");
    renderLeaderboard($("#player-final-leaderboard"), leaderboard, roomQuizPlayerId);
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
  const buddy = buzzin.buddy;
  $("#room-buzzin-buddy").textContent = buddy?.description || buddy?.importNumber || "";
  $("#room-buzzin-questions").innerHTML = buzzin.questions
    .map((q) => `<li>${escapeHtml(q)}</li>`)
    .join("");
  showScreen("room-buzzin");
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
