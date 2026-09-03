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
let roomBuzzinRecordTimeout = null;
let roomBuzzinRecordEndsAt = 0;
let roomBuzzinRecordStartedAt = 0;
let roomBuzzinSubmitInFlight = false;
const ROOM_BUZZIN_MAX_RECORD_MS = 30000;
const ROOM_BUZZIN_MIN_RECORD_MS = 600;
const ROOM_BUZZIN_SUBMIT_TIMEOUT_MS = 60000;

function isRoomBuzzinBusy() {
  return roomBuzzinSubmitInFlight || Boolean(roomBuzzinPcmRecorder?.isRecording());
}

function clearRoomBuzzinRecordTimeout() {
  if (roomBuzzinRecordTimeout) {
    clearTimeout(roomBuzzinRecordTimeout);
    roomBuzzinRecordTimeout = null;
  }
}

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

function hideStudentBuzzinAnswerPrompt() {
  const panel = $("#room-buzzin-answer-prompt");
  const screen = $("#screen-room-buzzin");
  if (panel) panel.hidden = true;
  screen?.classList.remove("has-answer-prompt");
}

function syncStudentBuzzinSpectatorUi(payload) {
  const playerId = roomParticipant?.userId;
  const phase = payload?.phase || "join";
  const myBuzz = (payload?.buzzes || []).find((b) => b.playerId === playerId);
  const myResponse = (payload?.responses || []).find((r) => r.playerId === playerId);
  const currentTurn = payload?.currentTurn || null;
  const firstBuzz = (payload.buzzes || [])[0] || null;
  const isMyAnswerTurn =
    currentTurn?.playerId === playerId ||
    (!currentTurn && firstBuzz?.playerId === playerId);
  const announcement = payload?.answerAnnouncement;
  const isAnnouncedForMe = announcement?.playerId === playerId;

  if (phase === "ready" || phase === "join") {
    hideStudentBuzzinWatchingPrompt();
    return;
  }

  if (isAnnouncedForMe && phase === "typing" && !myResponse && !payload?.typingComplete) {
    hideStudentBuzzinWatchingPrompt();
    return;
  }

  if (myBuzz && isMyAnswerTurn && !myResponse && !payload?.typingComplete) {
    hideStudentBuzzinWatchingPrompt();
    return;
  }

  if (phase === "typing" || phase === "done") {
    const variant =
      announcement && announcement.playerId !== playerId
        ? "selected"
        : !myBuzz && (payload?.buzzes || []).length
          ? "buzz"
          : "selected";
    setRoomBuzzinWatchingUi(payload, { variant });
    return;
  }

  hideStudentBuzzinWatchingPrompt();
}

function syncStudentBuzzinAnswerPrompt(payload) {
  const panel = $("#room-buzzin-answer-prompt");
  const topicEl = $("#room-buzzin-answer-prompt-topic");
  const nameEl = $("#room-buzzin-answer-prompt-name");
  const turnStatus = $("#room-buzzin-turn-status");
  const screen = $("#screen-room-buzzin");
  const playerId = roomParticipant?.userId;
  const announcement = payload?.answerAnnouncement;
  if (!panel) return;

  const hasSubmitted = (payload?.responses || []).some((entry) => entry.playerId === playerId);
  const isForMe =
    announcement?.playerId === playerId &&
    payload?.phase === "typing" &&
    !hasSubmitted &&
    !payload?.typingComplete;

  if (!isForMe) {
    hideStudentBuzzinAnswerPrompt();
    return;
  }

  const topic = String(payload?.topic || "").trim();
  if (topicEl) topicEl.textContent = topic || uiT("buzzin.listenTeacher");
  if (nameEl) {
    nameEl.textContent = uiT("buzzin.nameYoureUp", { name: announcement.displayName || "You" });
  }
  if (turnStatus) {
    turnStatus.textContent = uiT("buzzin.tapWhenFinished");
  }

  panel.hidden = false;
  screen?.classList.add("has-answer-prompt");
}

function setRoomBuzzinRecordingMode(active) {
  const screen = $("#screen-room-buzzin");
  const panel = $("#room-buzzin-recording-panel");
  const timeEl = $("#room-buzzin-recording-time");
  const turnStatus = $("#room-buzzin-turn-status");
  const title = $("#room-buzzin-card-title");

  if (active) hideStudentBuzzinAnswerPrompt();
  if (screen) screen.classList.toggle("is-recording", !!active);
  if (panel) panel.hidden = !active;
  if (turnStatus) turnStatus.hidden = !!active;
  if (title) title.textContent = active ? uiT("buzzin.recordingTitle") : uiT("buzzin.recordTitle");
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
  clearRoomBuzzinRecordTimeout();
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
    recordBtn.textContent = uiT("buzzin.record");
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

function getBuzzinActiveStudent(payload) {
  const announcement = payload?.answerAnnouncement;
  if (announcement?.displayName) {
    return {
      playerId: announcement.playerId || "",
      displayName: announcement.displayName,
    };
  }
  const currentTurn = payload?.currentTurn || null;
  if (currentTurn?.displayName) return currentTurn;
  const firstBuzz = (payload?.buzzes || [])[0] || null;
  if (firstBuzz?.displayName) return firstBuzz;
  return null;
}

function hideStudentBuzzinWatchingPrompt() {
  const panel = $("#room-buzzin-watching-prompt");
  const screen = $("#screen-room-buzzin");
  if (panel) panel.hidden = true;
  screen?.classList.remove("has-watching-prompt");
}

function setRoomBuzzinWatchingUi(payload, { variant = "selected" } = {}) {
  const panel = $("#room-buzzin-watching-prompt");
  const labelEl = $("#room-buzzin-watching-label");
  const topicEl = $("#room-buzzin-watching-topic");
  const nameEl = $("#room-buzzin-watching-name");
  const hintEl = $("#room-buzzin-watching-hint");
  const title = $("#room-buzzin-card-title");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  const recordBtn = $("#btn-room-buzzin-record");
  const submitted = $("#room-buzzin-submitted");
  const turnStatus = $("#room-buzzin-turn-status");
  const turnArea = $("#room-buzzin-turn");
  const screen = $("#screen-room-buzzin");
  const activeStudent = getBuzzinActiveStudent(payload);
  const selectedName = activeStudent?.displayName || uiT("buzzin.anotherStudent");
  const topic = String(payload?.topic || "").trim();

  hideStudentBuzzinAnswerPrompt();
  setRoomBuzzinRecordingMode(false);
  setRoomBuzzinMissedMode(false);

  if (panel) panel.hidden = false;
  screen?.classList.add("has-watching-prompt");

  if (variant === "buzz") {
    if (labelEl) labelEl.textContent = uiT("buzzin.tooLate");
    if (nameEl) nameEl.textContent = uiT("buzzin.buzzedFirst", { name: selectedName });
    if (hintEl) {
      hintEl.textContent = uiT("buzzin.watchHintLate");
    }
    if (title) title.textContent = uiT("buzzin.tooLate");
    if (status) {
      status.textContent = uiT("buzzin.anotherBuzzed");
    }
  } else {
    if (labelEl) labelEl.textContent = uiT("buzzin.watchListen");
    if (nameEl) nameEl.textContent = uiT("buzzin.isAnswering", { name: selectedName });
    if (hintEl) {
      hintEl.textContent = uiT("buzzin.watchQuiet");
    }
    if (title) title.textContent = uiT("buzzin.watchListen");
    if (status) {
      status.textContent = uiT("buzzin.wasChosen", { name: selectedName });
    }
  }

  if (topicEl) topicEl.textContent = topic || uiT("buzzin.listenTeacher");
  if (result) {
    result.hidden = true;
    result.textContent = "";
  }
  if (recordBtn) recordBtn.hidden = true;
  if (submitted) submitted.hidden = true;
  if (turnArea) turnArea.hidden = true;
  if (turnStatus) {
    turnStatus.hidden = true;
    turnStatus.textContent = "";
  }
}

function setRoomBuzzinMissedUi(payload) {
  setRoomBuzzinWatchingUi(payload || {}, { variant: "buzz" });
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
    recordBtn.textContent = uiT("buzzin.stop");
    recordBtn.classList.add("is-recording");
  }
  setRoomBuzzinRecordStatus("", false);

  clearRoomBuzzinRecordTimeout();
  roomBuzzinRecordTimeout = setTimeout(() => {
    roomBuzzinRecordTimeout = null;
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

  if (roomBuzzinSubmitInFlight) return;

  clearRoomBuzzinRecordTimeout();
  stopRoomBuzzinRecordTimer();
  roomBuzzinRecordEndsAt = 0;
  setRoomBuzzinRecordingMode(false);

  if (recordBtn) {
    recordBtn.textContent = uiT("buzzin.record");
    recordBtn.classList.remove("is-recording");
    recordBtn.disabled = true;
  }

  if (!recorder?.isRecording()) {
    setRoomBuzzinRecordStatus(uiT("buzzin.noAudio"));
    if (turnStatus) turnStatus.textContent = uiT("buzzin.noAudio");
    if (recordBtn) recordBtn.disabled = false;
    return;
  }

  const elapsed = Date.now() - (roomBuzzinRecordStartedAt || Date.now());
  if (elapsed < ROOM_BUZZIN_MIN_RECORD_MS) {
    recorder.cancel();
    roomBuzzinPcmRecorder = null;
    roomBuzzinRecordStartedAt = 0;
    setRoomBuzzinRecordStatus(uiT("buzzin.holdLonger"));
    if (turnStatus) turnStatus.textContent = uiT("buzzin.holdLonger");
    if (recordBtn) recordBtn.disabled = false;
    return;
  }

  roomBuzzinSubmitInFlight = true;
  setRoomBuzzinRecordStatus(
    timedOut ? uiT("buzzin.timeLimitSubmit") : uiT("buzzin.submitting")
  );
  if (turnStatus) {
    turnStatus.textContent = timedOut
      ? uiT("buzzin.timeLimitSubmit")
      : uiT("buzzin.submitting");
  }

  const failSubmit = (message) => {
    roomBuzzinSubmitInFlight = false;
    if (recordBtn) recordBtn.disabled = false;
    setRoomBuzzinRecordStatus(message || uiT("buzzin.submitError"));
    if (turnStatus) turnStatus.textContent = message || uiT("buzzin.submitError");
  };

  try {
    const wavBlob = await recorder.stop();
    roomBuzzinPcmRecorder = null;
    roomBuzzinRecordStartedAt = 0;
    setRoomBuzzinRecordStatus(uiT("buzzin.uploading"));
    const audioBase64 = await blobToWavBase64(wavBlob);
    if (!socket?.connected) {
      failSubmit(uiT("buzzin.submitError"));
      return;
    }

    const ack = (err, res) => {
      if (err) {
        failSubmit(uiT("buzzin.submitError"));
        return;
      }
      if (!res?.ok) {
        failSubmit(res?.error || uiT("buzzin.submitError"));
        return;
      }
      roomBuzzinSubmitInFlight = false;
      resetRoomBuzzinRecordingUi();
      updateStudentBuzzinUi(res);
    };

    if (typeof socket.timeout === "function") {
      socket.timeout(ROOM_BUZZIN_SUBMIT_TIMEOUT_MS).emit(
        "submit_buzzin_response",
        { audioBase64, format: "wav" },
        ack
      );
    } else {
      socket.emit("submit_buzzin_response", { audioBase64, format: "wav" }, (res) =>
        ack(null, res)
      );
    }
  } catch (err) {
    roomBuzzinPcmRecorder = null;
    roomBuzzinRecordStartedAt = 0;
    failSubmit(err.message || uiT("buzzin.submitError"));
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
  hideStudentBuzzinAnswerPrompt();
  hideStudentBuzzinWatchingPrompt();
  if (title) title.textContent = uiT("buzzin.recordTitle");
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
    syncStudentBuzzinSpectatorUi(payload);
    return;
  }

  if (myResponse) {
    hideStudentBuzzinWatchingPrompt();
    turnStatus.textContent = uiT("buzzin.submitted");
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) recordBtn.hidden = true;
    if (submitted) {
      submitted.hidden = false;
      submitted.textContent = uiT("buzzin.submitted");
    }
    return;
  }

  if (payload.typingComplete) {
    turnStatus.textContent = uiT("buzzin.roundComplete");
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) recordBtn.hidden = true;
    return;
  }

  if (isMyAnswerTurn) {
    turnStatus.textContent = payload?.answerAnnouncement?.playerId === playerId
      ? uiT("buzzin.tapWhenFinished")
      : uiT("buzzin.speakAnswer");
    const recordBtn = $("#btn-room-buzzin-record");
    if (recordBtn) {
      recordBtn.hidden = false;
      recordBtn.disabled = false;
    }
    if (submitted) submitted.hidden = true;
    syncStudentBuzzinAnswerPrompt(payload);
    return;
  }

  setRoomBuzzinWatchingUi(payload, { variant: "buzz" });
}

function updateStudentBuzzinUi(payload) {
  if (payload) joinLastBuzzinPayload = payload;
  const roundChanged =
    payload?.roundId != null &&
    roomBuzzinRoundId != null &&
    payload.roundId !== roomBuzzinRoundId;
  if (isRoomBuzzinBusy() && !roundChanged && payload?.phase !== "ready") {
    return;
  }
  const btn = $("#btn-room-buzz-in");
  const status = $("#room-buzzin-status");
  const result = $("#room-buzzin-result");
  if (!btn || !status) return;

  if (payload?.topic) {
    const topicEl = $("#room-buzzin-topic");
    if (topicEl) topicEl.textContent = payload.topic;
  }

  const phase = payload.phase || (payload.status === "full" ? "join" : payload.status === "closed" ? "typing" : "join");
  const playerId = roomParticipant?.userId;
  const myBuzz = (payload.buzzes || []).find((b) => b.playerId === playerId);
  const currentTurn = payload.currentTurn || null;
  const firstBuzz = (payload.buzzes || [])[0] || null;
  const isMyAnswerTurn =
    currentTurn?.playerId === playerId ||
    (!currentTurn && firstBuzz?.playerId === playerId);
  const joinClosed = phase !== "join" && phase !== "ready";

  if (phase === "ready") {
    btn.hidden = false;
    btn.disabled = true;
    hideRoomBuzzinJoinTimer();
    resetRoomBuzzinTurnUi();
    status.textContent = uiT("buzzin.waitTeacher");
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

  if (myBuzz && isMyAnswerTurn) {
    btn.disabled = true;
    result.hidden = false;
    result.textContent = payload?.answerAnnouncement?.playerId === playerId
      ? uiT("buzzin.youreUp")
      : uiT("buzzin.youBuzzed");
    result.className = "buzzin-result buzzin-result--selected";
    if (joinClosed) {
      status.textContent = payload?.answerAnnouncement?.playerId === playerId
        ? uiT("buzzin.listenThenRecord")
        : uiT("buzzin.youreUpRecord");
    } else {
      status.textContent = uiT("buzzin.youBuzzed");
    }
    syncStudentBuzzinAnswerPrompt(payload);
    return;
  }

  if (myBuzz && !isMyAnswerTurn) {
    btn.disabled = true;
    syncStudentBuzzinSpectatorUi(payload);
    return;
  }

  if (joinClosed) {
    btn.disabled = true;
    if (phase === "done") {
      status.textContent = uiT("buzzin.roundComplete");
      result.hidden = true;
      syncStudentBuzzinSpectatorUi(payload);
    } else {
      syncStudentBuzzinSpectatorUi(payload);
    }
    return;
  }

  btn.disabled = false;
  status.textContent = uiT("buzzin.tapBuzz");
  result.hidden = true;
  hideStudentBuzzinAnswerPrompt();
  hideStudentBuzzinWatchingPrompt();
}

function resetStudentBuzzinUi() {
  roomBuzzinRoundId = null;
  roomBuzzinSubmitInFlight = false;
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
  if (title) title.textContent = uiT("buzzin.recordTitle");
  if (status) status.textContent = uiT("buzzin.waitTeacher");
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
    resetStudentBuzzinUi();
    roomBuzzinRoundId = payload.roundId;
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
        if (status) status.textContent = res?.error || uiT("buzzin.buzzError");
        return;
      }

      const result = $("#room-buzzin-result");
      const status = $("#room-buzzin-status");
      if (result) {
        result.hidden = false;
        result.textContent = uiT("buzzin.youBuzzed");
        result.className = "buzzin-result buzzin-result--selected";
      }
      if (status) {
        status.textContent = uiT("buzzin.youBuzzedReady");
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
      setRoomBuzzinRecordStatus(err.message || uiT("buzzin.micError"));
      if (turnStatus) turnStatus.textContent = err.message || uiT("buzzin.micError");
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
    if (typeof setJoinWaitingStatus === "function") setJoinWaitingStatus("status.getReady");
    else $("#room-waiting-status").textContent = uiT("status.getReady");
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
    $("#player-mcq-title").textContent = uiT("mcq.questionN", { n: data.questionIndex + 1 });
    $("#player-q-meta").textContent = uiT("mcq.readQuestion");
    setQuestionImage(
      $("#player-question-image"),
      $("#player-question-image-wrap"),
      typeof resolvedMediaUrl === "function" ? resolvedMediaUrl(data.image) : data.image
    );
    $("#player-question-text").textContent = data.text || "";
    $("#player-options").innerHTML = "";
    $("#answer-feedback").textContent = uiT("mcq.getReadyAnswer");

    startDeadlineTimer(
      data.previewEndsAt,
      data.previewSeconds || 5,
      (remaining) => {
        $("#timer-text").textContent = remaining;
        $("#timer-ring").classList.toggle("urgent", remaining <= 1);
      }
    );
  });

  socket.on("question_speaking", (data) => {
    stopRoomStatusPoll();
    stopRoomQuizJoinRetry();
    roomQuizCurrentQuestion = data;
    if (data?.fastMode != null) roomQuizFastMode = !!data.fastMode;
    clearTimer();
    resetPlayerMcqAnsweredState();
    showScreen("player-question");

    const screen = $("#screen-player-question");
    screen?.classList.add("is-previewing");
    $("#player-mcq-title").textContent = uiT("mcq.questionN", { n: data.questionIndex + 1 });
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
    stopRoomStatusPoll();
    stopRoomQuizJoinRetry();
    roomQuizCurrentQuestion = data;
    if (data?.fastMode != null) roomQuizFastMode = !!data.fastMode;
    clearTimer();
    resetPlayerMcqAnsweredState();
    showScreen("player-question");
    $("#screen-player-question")?.classList.remove("is-previewing");
    $("#player-mcq-title").textContent = uiT("mcq.title");
    $("#player-q-meta").textContent =
      uiT("mcq.questionOf", { n: data.questionIndex + 1, total: data.totalQuestions });
    setQuestionImage(
      $("#player-question-image"),
      $("#player-question-image-wrap"),
      typeof resolvedMediaUrl === "function" ? resolvedMediaUrl(data.image) : data.image
    );
    $("#player-question-text").textContent = data.text;
    $("#answer-feedback").textContent = "";

    const optionsWrap = document.querySelector(".player-mcq-options-wrap");
    if (optionsWrap) {
      optionsWrap.dataset.shapeHint = isHkElderlyVariant() ? uiT("mcq.tapShape") : "";
    }

    renderOptions($("#player-options"), data.options, {
      clickable: true,
      optionLabels: isHkElderlyVariant() ? undefined : ["A.", "B.", "C.", "D.", "E.", "F."],
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
    $("#answer-feedback").textContent = roomQuizFastMode
      ? uiT("fast.answerSaved")
      : uiT("mcq.waitingOthers");
  });

  socket.on("question_between", ({ isLast } = {}) => {
    if (!roomQuizFastMode) return;
    clearTimer();
    $("#answer-feedback").textContent = isLast
      ? uiT("mcq.calculatingScore")
      : uiT("mcq.nextComing");
  });

  socket.on("question_results", ({ results, leaderboard }) => {
    if (roomQuizFastMode) return;
    clearTimer();
    showScreen("player-results");
    const mine = results.find((r) => r.playerId === roomQuizPlayerId);
    if (typeof joinLastMcqResult !== "undefined") {
      joinLastMcqResult = { mine, leaderboard, playerId: roomQuizPlayerId };
    }
    renderPlayerMcqResult(mine, leaderboard, roomQuizPlayerId);
  });

  socket.on("game_finished", ({ leaderboard, semesterLeaderboard, exerciseLeaderboard, answerReview, answerHistory, accuracyLeaderboard }) => {
    const wasFastMode = roomQuizFastMode;
    roomQuizFastMode = false;
    clearTimer();
    if (wasFastMode) {
      window.roomFastQuizCompleted = true;
      showScreen("player-fast-results");
      if (typeof renderPlayerFastMcResult === "function") {
        const fastPayload = {
          answerReview,
          answerHistory,
          leaderboard: exerciseLeaderboard || leaderboard,
          playerId: roomQuizPlayerId,
        };
        if (typeof joinLastFastResult !== "undefined") joinLastFastResult = fastPayload;
        renderPlayerFastMcResult(fastPayload);
      }
      return;
    }
    showScreen("player-finished");
    joinLastLeaderboard = {
      exerciseLeaderboard: exerciseLeaderboard || leaderboard,
      semesterLeaderboard,
      accuracyLeaderboard,
      totalQuestions: answerReview?.length || 0,
      highlightId: roomQuizPlayerId,
      exerciseListEl: $("#player-final-leaderboard"),
      semesterListEl: $("#player-semester-leaderboard"),
      semesterWrapEl: $("#player-semester-leaderboard-wrap"),
      exerciseWrapEl: $("#player-exercise-leaderboard-wrap"),
    };
    showExerciseLeaderboards(joinLastLeaderboard);
    const playBtn = $("#btn-play-again");
    if (playBtn) playBtn.hidden = true;
  });

  socket.on("game_ended", () => {
    clearTimer();
    if (typeof showClassEnded === "function") {
      showClassEnded({ statusKey: "join.endedStatus" });
      return;
    }
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
        if (typeof setJoinWaitingStatus === "function") setJoinWaitingStatus("status.waitNextQ");
        else $("#room-waiting-status").textContent = uiT("status.waitNextQ");
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
  const title = exercise?.title || uiT("join.watchTitle");

  const titleEl = $("#room-passive-waiting-title");
  if (titleEl) {
    titleEl.textContent = title;
    if (exercise?.title) titleEl.dataset.customTitle = "1";
    else delete titleEl.dataset.customTitle;
  }
  $("#room-passive-waiting-status").textContent = uiT("join.watchStatus");
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
