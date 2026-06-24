/** Student MC quiz for Lango room join — syncs via Socket.IO, no question API. */
let roomQuizSocket = null;
let roomQuizPlayerId = null;
let roomQuizCurrentQuestion = null;
let roomQuizJoinTimer = null;
let roomQuizFastMode = false;
let roomBuzzinSocketReady = false;
let roomBuzzinRoundId = null;
let roomBuzzinJoinTimer = null;
let roomBuzzinMediaRecorder = null;
let roomBuzzinAudioChunks = [];
let roomBuzzinRecordedBlob = null;
let roomBuzzinRecordedFormat = "webm";
let roomBuzzinRecordStream = null;
const ROOM_BUZZIN_MAX_RECORD_MS = 60000;

function stopRoomBuzzinRecording() {
  if (roomBuzzinMediaRecorder && roomBuzzinMediaRecorder.state !== "inactive") {
    roomBuzzinMediaRecorder.stop();
  } else if (roomBuzzinRecordStream) {
    roomBuzzinRecordStream.getTracks().forEach((track) => track.stop());
    roomBuzzinRecordStream = null;
  }
}

function waitForRoomBuzzinRecordedBlob(timeoutMs = 3000) {
  if (roomBuzzinRecordedBlob?.size) {
    return Promise.resolve(roomBuzzinRecordedBlob);
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (roomBuzzinRecordedBlob?.size) {
        resolve(roomBuzzinRecordedBlob);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("No audio captured. Try recording again."));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function resetRoomBuzzinRecordingUi() {
  stopRoomBuzzinRecording();
  roomBuzzinAudioChunks = [];
  roomBuzzinRecordedBlob = null;
  roomBuzzinRecordedFormat = "webm";

  const recordBtn = $("#btn-room-buzzin-record");
  const recordStatus = $("#room-buzzin-record-status");
  if (recordBtn) {
    recordBtn.disabled = false;
    recordBtn.textContent = "Record answer";
    recordBtn.classList.remove("is-recording");
  }
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
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone recording is not supported in this browser.");
  }

  resetRoomBuzzinRecordingUi();
  roomBuzzinRecordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  roomBuzzinAudioChunks = [];
  roomBuzzinRecordedBlob = null;

  const preferredTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  roomBuzzinRecordedFormat = mimeType.includes("mp4")
    ? "m4a"
    : mimeType.includes("ogg")
      ? "ogg"
      : "webm";

  roomBuzzinMediaRecorder = mimeType
    ? new MediaRecorder(roomBuzzinRecordStream, { mimeType })
    : new MediaRecorder(roomBuzzinRecordStream);

  roomBuzzinMediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) roomBuzzinAudioChunks.push(event.data);
  });

  roomBuzzinMediaRecorder.addEventListener("stop", () => {
    if (roomBuzzinRecordStream) {
      roomBuzzinRecordStream.getTracks().forEach((track) => track.stop());
      roomBuzzinRecordStream = null;
    }

    if (!roomBuzzinAudioChunks.length) {
      roomBuzzinMediaRecorder = null;
      return;
    }

    const blobType = mimeType || "audio/webm";
    roomBuzzinRecordedBlob = new Blob(roomBuzzinAudioChunks, {
      type: blobType,
    });
    roomBuzzinAudioChunks = [];
    roomBuzzinMediaRecorder = null;
  });

  roomBuzzinMediaRecorder.start();
  const recordBtn = $("#btn-room-buzzin-record");
  if (recordBtn) {
    recordBtn.textContent = "Stop recording";
    recordBtn.classList.add("is-recording");
  }
  setRoomBuzzinRecordStatus("Recording… tap Stop when finished.");

  setTimeout(() => {
    if (roomBuzzinMediaRecorder?.state === "recording") {
      void finishRoomBuzzinRecordingAndSubmit({ timedOut: true });
    }
  }, ROOM_BUZZIN_MAX_RECORD_MS);
}

async function finishRoomBuzzinRecordingAndSubmit({ timedOut = false } = {}) {
  const socket = getRoomSessionSocket();
  const recordBtn = $("#btn-room-buzzin-record");
  const turnStatus = $("#room-buzzin-turn-status");

  if (roomBuzzinMediaRecorder?.state === "recording") {
    stopRoomBuzzinRecording();
  }

  if (recordBtn) {
    recordBtn.textContent = "Record answer";
    recordBtn.classList.remove("is-recording");
    recordBtn.disabled = true;
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
    const blob = await waitForRoomBuzzinRecordedBlob();
    setRoomBuzzinRecordStatus("Converting recording to WAV…");
    const audioBase64 = await blobToWavBase64(blob);
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

  resetRoomBuzzinRecordingUi();
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

  if (phase === "join") {
    resetRoomBuzzinTurnUi();
    return;
  }

  if (!turnArea || !turnStatus) return;
  turnArea.hidden = false;
  hideRoomBuzzinJoinTimer();

  if (!myBuzz) {
    turnStatus.textContent = "Buzz in closed. You did not buzz in time.";
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) recordBtn.hidden = true;
    if (submitted) submitted.hidden = true;
    return;
  }

  if (myResponse) {
    turnStatus.textContent = `You answered (#${myResponse.rank}). Waiting for others…`;
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) recordBtn.hidden = true;
    if (submitted) {
      submitted.hidden = false;
      submitted.textContent = "Your answer was submitted.";
    }
    return;
  }

  if (payload.typingComplete) {
    turnStatus.textContent = "All answers submitted.";
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) recordBtn.hidden = true;
    return;
  }

  if (currentTurn?.playerId === playerId) {
    turnStatus.textContent = `You're #${myBuzz.rank} — tap Record and speak your answer.`;
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) {
      recordBtn.hidden = false;
      recordBtn.disabled = false;
    }
    if (submitted) submitted.hidden = true;
    return;
  }

  const waitingFor = currentTurn?.displayName || "another student";
  turnStatus.textContent = `You're #${myBuzz.rank}. Waiting for ${waitingFor} (#${currentTurn?.rank || "?"})…`;
  const recordBtn = $("#btn-room-buzzin-record");
  if (recordBtn) recordBtn.hidden = true;
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

  $("#btn-room-buzzin-record")?.addEventListener("click", async () => {
    const recordBtn = $("#btn-room-buzzin-record");
    const turnStatus = $("#room-buzzin-turn-status");
    if (!recordBtn || recordBtn.disabled) return;

    if (roomBuzzinMediaRecorder?.state === "recording") {
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

  socket.on("question_start", (data) => {
    stopRoomStatusPoll();
    stopRoomQuizJoinRetry();
    roomQuizCurrentQuestion = data;
    clearTimer();
    resetPlayerMcqAnsweredState();
    showScreen("player-question");
    $("#player-q-meta").textContent =
      `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
    setQuestionImage($("#player-question-image"), $("#player-question-image-wrap"), null);
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

  socket.on("game_finished", ({ leaderboard, semesterLeaderboard, exerciseLeaderboard }) => {
    const wasFastMode = roomQuizFastMode;
    roomQuizFastMode = false;
    clearTimer();
    if (wasFastMode) {
      window.roomFastQuizCompleted = true;
      if (typeof showPlayerPassiveWaiting === "function") {
        showPlayerPassiveWaiting();
      } else {
        showScreen("room-passive-waiting");
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
