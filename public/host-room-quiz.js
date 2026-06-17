/** Socket.IO live exercises for Lango host — content from CMS course detail. */
let roomQuizSocket = null;
let roomQuizCurrentQuestion = null;
let roomQuizFastMode = false;

const HOST_MCQ_OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];
const HOST_MCQ_OPTION_COLORS = ["#15c4f8", "#45c937", "#f33b3d", "#eab308", "#a855f7", "#14b8a6"];
let hostBuzzinSocketReady = false;
let hostBuzzinRoomId = null;

function updateHostBuzzinUi(payload) {
  renderBuzzinWinnersList(
    $("#host-buzzin-winners"),
    payload.winners || [],
    "Waiting for students to buzz in…"
  );
  const countEl = $("#host-buzzin-buzz-count");
  if (countEl) {
    const total = payload.totalBuzzes || 0;
    countEl.textContent = total
      ? `${total} student${total === 1 ? "" : "s"} buzzed in`
      : "Students tap BUZZ IN on their devices.";
  }
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
}

function startHostBuzzinRound(roomId) {
  if (!roomId) return Promise.resolve();
  hostBuzzinRoomId = roomId;
  ensureHostBuzzinSocket();

  renderBuzzinWinnersList($("#host-buzzin-winners"), [], "Waiting for students to buzz in…");
  const countEl = $("#host-buzzin-buzz-count");
  if (countEl) countEl.textContent = "Students tap BUZZ IN on their devices.";

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

  socket.on("game_finished", ({ leaderboard }) => {
    roomQuizFastMode = false;
    showScreen("host-quiz-finished");
    renderLeaderboard($("#host-quiz-final-leaderboard"), leaderboard);
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

  $("#host-buzzin-title").textContent = buzzin.title;
  $("#host-buzzin-buddy").textContent = buddyDisplayText(buzzin.buddy);
  $("#host-buzzin-questions").innerHTML = renderBuzzinQuestionList(buzzin.questions);
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
