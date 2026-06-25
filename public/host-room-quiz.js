/** Socket.IO live exercises for Lango host — content from CMS course detail. */
let roomQuizSocket = null;
let roomQuizCurrentQuestion = null;
let roomQuizFastMode = false;

const HOST_MCQ_OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];
const HOST_MCQ_OPTION_COLORS = ["#15c4f8", "#45c937", "#f33b3d", "#eab308", "#a855f7", "#14b8a6"];
let hostBuzzinSocketReady = false;
let hostBuzzinRoomId = null;
let hostBuzzinJoinTimer = null;
const hostBuzzinPlayedAnalysisAudio = new Set();
let hostBuzzinLastResponses = [];

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

  hostBuzzinLastResponses = payload.responses || [];

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
    turnStatus.textContent = "Student has answered.";
  } else if (payload.currentTurn) {
    turnStatus.textContent = `Waiting for ${payload.currentTurn.displayName} to record their answer…`;
  } else {
    turnStatus.textContent = "Waiting for the student to answer…";
  }

  renderBuzzinResponsesList(
    responsesEl,
    payload.responses || [],
    payload.typingComplete ? null : payload.currentTurn,
    "Waiting for answers…"
  );
  playNewBuzzinAnalysisAudio(payload.responses, hostBuzzinPlayedAnalysisAudio);
}

function updateHostBuzzinUi(payload) {
  const activity = $("#host-buzzin-activity");
  if (activity) {
    activity.hidden = (payload.phase || "join") === "join" && !(payload.totalBuzzes || 0);
  }
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
      const winner = payload.winners?.[0] || payload.buzzes?.[0];
      countEl.textContent = winner
        ? `${winner.displayName} buzzed in first!`
        : `First student to buzz in wins — ${payload.joinSecondsRemaining ?? 20}s left`;
    } else if (phase === "typing") {
      countEl.textContent = total
        ? "Waiting for the student to answer…"
        : "Buzz window closed — no one buzzed in.";
    } else {
      countEl.textContent = total ? "Student finished answering." : "Buzz round complete.";
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

  $("#host-buzzin-responses")?.addEventListener("click", (event) => {
    const btn = event.target.closest(".buzzin-analysis-play");
    if (!btn) return;
    const key = btn.getAttribute("data-buzzin-analysis-key");
    if (!key) return;
    const [playerId, atRaw] = key.split(":");
    const at = Number(atRaw);
    const item = (hostBuzzinLastResponses || []).find(
      (response) => response.playerId === playerId && response.at === at
    );
    if (item) playBuzzinAnalysisAudio(item);
  });
}

function startHostBuzzinRound(roomId) {
  if (!roomId) return Promise.resolve();
  hostBuzzinRoomId = roomId;
  hostBuzzinPlayedAnalysisAudio.clear();
  hostBuzzinLastResponses = [];
  ensureHostBuzzinSocket();
  hideHostBuzzinJoinTimer();
  const turnPanel = $("#host-buzzin-turn-panel");
  if (turnPanel) turnPanel.hidden = true;
  const activity = $("#host-buzzin-activity");
  if (activity) activity.hidden = true;

  renderBuzzinWinnersList($("#host-buzzin-winners"), [], "Waiting for students to buzz in…");
  const countEl = $("#host-buzzin-buzz-count");
  if (countEl) countEl.textContent = "First student to buzz in wins — 20 seconds.";

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

  const progress = $("#host-quiz-preview-progress");
  startDeadlineTimer(data.previewEndsAt, data.previewSeconds || 5, (remaining) => {
    const total = Math.max(1, Number(data.previewSeconds) || 5);
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    progress.style.width = `${pct}%`;
  });
}

function renderHostQuizQuestion(data, { preparing = false } = {}) {
  const screen = $("#screen-host-quiz-question");
  const isFastMode = !!data.fastMode;
  screen?.classList.toggle("fast-mode", isFastMode);
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

function renderFastAccuracyLeaderboard(results) {
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
      const cards = students.map((student) => {
        const name = String(student.name || "Student").trim() || "Student";
        const index = studentIndex++;
        return `<article class="host-fast-result-student">
          <span class="host-fast-result-avatar" style="--student-i:${index}" aria-hidden="true">${escapeHtml(initialsForName(name))}</span>
          <span class="host-fast-result-name">${escapeHtml(name)}</span>
        </article>`;
      }).join("");

      return `<section class="host-fast-result-group${students.length > 3 ? " is-expanded" : ""}">
        <h3 class="host-fast-result-score"><strong>${correctAnswers}</strong><span>correct</span></h3>
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

  socket.on("question_start", (data) => {
    roomQuizCurrentQuestion = data;
    renderHostQuizQuestion(data);
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

  socket.on("game_finished", ({ leaderboard, accuracyLeaderboard, semesterLeaderboard, exerciseLeaderboard }) => {
    const wasFastMode = roomQuizFastMode;
    roomQuizFastMode = false;
    if (typeof markCurrentHostExerciseCompleted === "function") {
      markCurrentHostExerciseCompleted();
    }
    if (wasFastMode) {
      renderFastAccuracyLeaderboard(accuracyLeaderboard || []);
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

  $("#host-buzzin-topic").textContent = buzzin.topic;
  const pointsEl = $("#host-buzzin-points");
  if (pointsEl) {
    const points = typeof exercisePointsValue === "function" ? exercisePointsValue(exercise) : 300;
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
