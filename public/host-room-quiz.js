/** Socket.IO live exercises for Lango host — content from CMS course detail. */
let roomQuizSocket = null;
let roomQuizCurrentQuestion = null;
let roomQuizFastMode = false;

const HOST_MCQ_OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];
const HOST_MCQ_OPTION_COLORS = ["#15c4f8", "#45c937", "#f33b3d", "#eab308", "#a855f7", "#14b8a6"];
let hostBuzzinSocketReady = false;
let hostBuzzinRoomId = null;
let hostBuzzinJoinTimer = null;

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
  const phase = payload.phase || "join";
  const panel = $("#host-buzzin-turn-panel");
  const turnStatus = $("#host-buzzin-turn-status");
  const responsesEl = $("#host-buzzin-responses");
  if (!panel || !turnStatus || !responsesEl) return;

  if (phase === "join") {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  hideHostBuzzinJoinTimer();

  if (!payload.buzzes?.length) {
    turnStatus.textContent = "No one buzzed in.";
    renderBuzzinResponsesList(responsesEl, [], null, "No answers yet.");
    return;
  }

  if (payload.typingComplete) {
    turnStatus.textContent = "All students have answered.";
  } else if (payload.currentTurn) {
    turnStatus.textContent = `Waiting for ${payload.currentTurn.displayName} (#${payload.currentTurn.rank}) to type their answer…`;
  } else {
    turnStatus.textContent = "Students answer in buzz order.";
  }

  renderBuzzinResponsesList(
    responsesEl,
    payload.responses || [],
    payload.typingComplete ? null : payload.currentTurn,
    "Waiting for answers…"
  );
}

function updateHostBuzzinUi(payload) {
  renderBuzzinWinnersList(
    $("#host-buzzin-winners"),
    payload.buzzes || [],
    "Waiting for students to buzz in…"
  );
  const countEl = $("#host-buzzin-buzz-count");
  const phase = payload.phase || "join";
  if (countEl) {
    const total = payload.totalBuzzes || 0;
    if (phase === "join") {
      countEl.textContent = total
        ? `${total} student${total === 1 ? "" : "s"} buzzed in — ${payload.joinSecondsRemaining ?? 20}s left`
        : `Students have ${payload.joinSeconds ?? 20} seconds to buzz in.`;
    } else if (phase === "typing") {
      countEl.textContent = total
        ? `${total} student${total === 1 ? "" : "s"} answer in buzz order.`
        : "Buzz window closed — no buzzes.";
    } else {
      countEl.textContent = total
        ? `${total} student${total === 1 ? "" : "s"} finished answering.`
        : "Buzz round complete.";
    }
  }

  if (phase === "join") {
    startHostBuzzinJoinTimer(payload.joinEndsAt);
  } else {
    hideHostBuzzinJoinTimer();
  }
  updateHostBuzzinTurnUi(payload);
}

function ensureHostBuzzinSocket() {
  if (hostBuzzinSocketReady) return;
  hostBuzzinSocketReady = true;

  const socket = getHostSessionSocket();

  socket.on("buzzin_round_started", (payload) => {
    updateHostBuzzinUi(payload);
  });

  socket.on("buzzin_update", (payload) => {
    updateHostBuzzinUi(payload);
  });

  socket.on("buzzin_join_closed", (payload) => {
    if (payload.roundId != null && roomBuzzinRoundId == null) {
      roomBuzzinRoundId = payload.roundId;
    }
    updateHostBuzzinUi(payload);
  });

  socket.on("buzzin_response_analyzed", (payload) => {
    updateHostBuzzinUi(payload);
  });
}

function startHostBuzzinRound(roomId) {
  if (!roomId) return Promise.resolve();
  hostBuzzinRoomId = roomId;
  ensureHostBuzzinSocket();
  hideHostBuzzinJoinTimer();
  const turnPanel = $("#host-buzzin-turn-panel");
  if (turnPanel) turnPanel.hidden = true;

  renderBuzzinWinnersList($("#host-buzzin-winners"), [], "Waiting for students to buzz in…");
  const countEl = $("#host-buzzin-buzz-count");
  if (countEl) countEl.textContent = "Students have 20 seconds to buzz in.";

  const socket = getHostSessionSocket();

  return new Promise((resolve, reject) => {
    const run = () => {
      socket.emit("start_buzzin_round", { roomId }, (res) => {
        if (!res?.ok) {
          reject(new Error(res?.error || "Could not start buzz-in round."));
          return;
        }
        updateHostBuzzinUi(res);
        resolve();
      });
    };

    if (socket.connected) run();
    else socket.once("connect", run);
  });
}

function getRoomQuizSocket() {
  if (!roomQuizSocket) {
    roomQuizSocket = io({ transports: ["websocket", "polling"] });
    setupHostRoomQuizSocket(roomQuizSocket);
  }
  return roomQuizSocket;
}

function renderHostQuizQuestion(data, { preparing = false } = {}) {
  showScreen("host-quiz-question");
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
    resolvedMediaUrl(data.image)
  );
  $("#host-quiz-question-text").textContent = data.text || "";
  renderOptions($("#host-quiz-options"), data.options || [], {
    clickable: false,
    optionLabels: HOST_MCQ_OPTION_LABELS,
  });
  $("#host-quiz-answered-count").textContent = preparing
    ? "Starting shortly…"
    : "Students are answering…";
  startTimer(data.timeLimit || 5, (remaining) => {
    $("#host-quiz-countdown").textContent = String(Math.max(0, remaining));
  });
}

function resultResponseLabel(count) {
  return `${count} Response${count === 1 ? "" : "s"}`;
}

function renderHostResultDistribution(question, answerCounts) {
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
      return `<div class="host-mcq-legend-item">
        <span class="host-mcq-legend-label">
          <span class="host-mcq-legend-dot" style="--dot-color: ${color}"></span>
          <span>${label} ${escapeHtml(option)}</span>
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

function setupHostRoomQuizSocket(socket) {
  socket.on("game_starting", ({ fastMode } = {}) => {
    roomQuizFastMode = !!fastMode;
  });

  socket.on("question_start", (data) => {
    roomQuizCurrentQuestion = data;
    renderHostQuizQuestion(data);
  });

  socket.on("question_between", ({ isLast } = {}) => {
    if (!roomQuizFastMode) return;
    clearTimer();
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
    $("#host-quiz-results-correct-answer").textContent =
      `Correct Answer: ${HOST_MCQ_OPTION_LABELS[correctIndex] || ""} ${correctAnswer}`.trim();
    $("#host-quiz-results-explanation").textContent = correctAnswer
      ? `${correctAnswer} is the correct answer for this question.`
      : "Review the class responses before moving on.";
    $("#host-quiz-results-bars").innerHTML = "";
    renderHostResultDistribution(q, answerCounts);
    renderCorrectResponders(results);
    renderLeaderboard($("#host-quiz-leaderboard"), leaderboard);
    const isLast = q && q.questionIndex + 1 >= q.totalQuestions;
    $("#btn-host-quiz-next").textContent = isLast ? "Show final results" : "Next question";
  });

  socket.on("game_finished", ({ leaderboard, semesterLeaderboard, exerciseLeaderboard }) => {
    roomQuizFastMode = false;
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

function showHostVideoExercise(exercise) {
  const url = resolvedMediaUrl(videoUrlFromExercise(exercise));
  if (!url) throw new Error("No video URL in this exercise.");

  $("#host-video-title").textContent = exercise.title || "Video";
  $("#host-video-subtitle").textContent = exercise.subTitle || "";
  const video = $("#host-video-player");
  video.src = url;
  video.load();
  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  showScreen("host-video");
}

function showHostBuzzinExercise(exercise, roomId) {
  const buzzin = buzzinFromExercise(exercise);
  if (!buzzin) throw new Error("No Buzz In content in this exercise.");

  $("#host-buzzin-topic").textContent = buzzin.topic;
  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  showScreen("host-buzzin");
  return startHostBuzzinRound(roomId);
}

function startHostExercise(roomId, exercise) {
  if (isLiveMcQuizExercise(exercise)) {
    return startHostRoomQuiz(roomId, exercise);
  }
  if (isVideoExercise(exercise)) {
    showHostVideoExercise(exercise);
    return Promise.resolve();
  }
  if (isBuzzinExercise(exercise)) {
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
            options: firstQuestion.options,
            timeLimit: firstQuestion.timeLimit || 5,
            fastMode: quiz.fastMode,
            image: resolvedMediaUrl(firstQuestion.image) || null,
          };
          renderHostQuizQuestion(roomQuizCurrentQuestion, { preparing: true });
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
    getRoomQuizSocket().emit("next_question");
  });

  $("#btn-host-buzzin-reset")?.addEventListener("click", () => {
    const roomId = hostBuzzinRoomId || state?.activeRoomId;
    if (!roomId) return;
    void startHostBuzzinRound(roomId).catch((err) => {
      $("#waiting-error").textContent = err.message;
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHostRoomQuizUi);
} else {
  initHostRoomQuizUi();
}
