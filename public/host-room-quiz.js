/** Socket.IO live exercises for Lango host — content from CMS course detail. */
let roomQuizSocket = null;
let roomQuizCurrentQuestion = null;

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
  $("#host-quiz-progress").style.width = `${pct}%`;
  $("#host-quiz-q-meta").textContent = preparing
    ? "Get ready…"
    : `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
  setQuestionImage($("#host-quiz-question-image"), $("#host-quiz-question-image-wrap"), data.image);
  $("#host-quiz-question-text").textContent = data.text || "";
  renderOptions($("#host-quiz-options"), data.options || [], { clickable: false });
  $("#host-quiz-answered-count").textContent = preparing
    ? "Starting shortly…"
    : "Students are answering…";
}

function setupHostRoomQuizSocket(socket) {
  socket.on("question_start", (data) => {
    roomQuizCurrentQuestion = data;
    renderHostQuizQuestion(data);
  });

  socket.on("question_results", ({ correctIndex, answerCounts, leaderboard }) => {
    showScreen("host-quiz-results");
    const q = roomQuizCurrentQuestion;
    setQuestionImage(
      $("#host-quiz-results-image"),
      $("#host-quiz-results-image-wrap"),
      q?.image
    );
    $("#host-quiz-results-question-text").textContent = q?.text || "";
    const total = answerCounts.reduce((a, b) => a + b, 0) || 1;
    const pcts = answerCounts.map((c) => Math.round((c / total) * 100));
    renderOptions($("#host-quiz-results-bars"), q?.options || [], {
      clickable: false,
      showBars: true,
      counts: pcts,
      correctIndex,
    });
    renderLeaderboard($("#host-quiz-leaderboard"), leaderboard);
    const isLast = q && q.questionIndex + 1 >= q.totalQuestions;
    $("#btn-host-quiz-next").textContent = isLast ? "Show final results" : "Next question";
  });

  socket.on("game_finished", ({ leaderboard }) => {
    showScreen("host-quiz-finished");
    renderLeaderboard($("#host-quiz-final-leaderboard"), leaderboard);
    if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  });

  socket.on("game_ended", ({ reason }) => {
    alert(reason || "Quiz ended");
  });
}

function showHostVideoExercise(exercise) {
  const url = videoUrlFromExercise(exercise);
  if (!url) throw new Error("No video URL in this exercise.");

  $("#host-video-title").textContent = exercise.title || "Video";
  $("#host-video-subtitle").textContent = exercise.subTitle || "";
  const video = $("#host-video-player");
  video.src = url;
  video.load();
  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  showScreen("host-video");
}

function showHostBuzzinExercise(exercise) {
  const buzzin = buzzinFromExercise(exercise);
  if (!buzzin) throw new Error("No Buzz In content in this exercise.");

  $("#host-buzzin-title").textContent = buzzin.title;
  const buddy = buzzin.buddy;
  $("#host-buzzin-buddy").textContent = buddy?.description || buddy?.importNumber || "";
  $("#host-buzzin-questions").innerHTML = buzzin.questions
    .map((q) => `<li>${escapeHtml(q)}</li>`)
    .join("");
  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  showScreen("host-buzzin");
}

function startHostExercise(roomId, exercise) {
  if (isMcQuizExercise(exercise)) {
    return startHostRoomQuiz(roomId, exercise);
  }
  if (isVideoExercise(exercise)) {
    showHostVideoExercise(exercise);
    return Promise.resolve();
  }
  if (isBuzzinExercise(exercise)) {
    showHostBuzzinExercise(exercise);
    return Promise.resolve();
  }
  return Promise.reject(new Error(`Unsupported exercise type: ${exercise?.type || "unknown"}`));
}

function startHostRoomQuiz(roomId, exercise) {
  const quiz = mcQuizPayloadFromExercise(exercise);
  if (!quiz?.questions?.length) {
    return Promise.reject(new Error("No quiz questions in this exercise."));
  }

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
            image: firstQuestion.image || null,
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHostRoomQuizUi);
} else {
  initHostRoomQuizUi();
}
