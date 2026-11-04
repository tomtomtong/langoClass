/**
 * Student side of "Everyone Answers": every student records a spoken answer
 * while the window is open, then sees their own feedback. Unlike Buzz In
 * there is no buzzing and no turn; the room only sends a student their own
 * answer (see worker/room-open-answer.js).
 */
let openAnswerRoundId = null;
let openAnswerState = null;
let openAnswerMine = null;
let openAnswerRecorder = null;
let openAnswerRecordStartedAt = 0;
let openAnswerRecordTimeout = null;
let openAnswerSubmitting = false;
let openAnswerTicker = null;
let openAnswerRecordTicker = null;
let openAnswerRecordEndsAt = 0;
const OPEN_ANSWER_MAX_RECORD_MS = 30000;
const OPEN_ANSWER_MIN_RECORD_MS = 600;
const OPEN_ANSWER_SUBMIT_WAIT_MS = 60000;

function openAnswerEl(id) {
  return $(`#room-openanswer-${id}`);
}

function openAnswerRemainingMs() {
  if (!openAnswerState || openAnswerState.phase !== "answering") return 0;
  return Math.max(0, serverTimeToLocal(openAnswerState.endsAt) - Date.now());
}

function openAnswerBusy() {
  return openAnswerSubmitting || Boolean(openAnswerRecorder?.isRecording());
}

function formatOpenAnswerRecordTime(ms) {
  return `00 : ${String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, "0")} s`;
}

function stopOpenAnswerRecordTicker() {
  if (openAnswerRecordTicker) clearInterval(openAnswerRecordTicker);
  openAnswerRecordTicker = null;
}

function cancelOpenAnswerRecording() {
  if (openAnswerRecordTimeout) clearTimeout(openAnswerRecordTimeout);
  openAnswerRecordTimeout = null;
  stopOpenAnswerRecordTicker();
  openAnswerRecordStartedAt = 0;
  openAnswerRecordEndsAt = 0;
  if (openAnswerRecorder?.cancel) openAnswerRecorder.cancel();
  openAnswerRecorder = null;
}

function setOpenAnswerRecordStatus(message) {
  const el = openAnswerEl("record-status");
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
}

function setOpenAnswerRecordingMode(active) {
  openAnswerEl("recording-panel")?.toggleAttribute("hidden", !active);
  $("#screen-room-openanswer")?.classList.toggle("is-recording", !!active);
  const btn = openAnswerEl("record-btn");
  if (btn) {
    btn.textContent = uiT(active ? "buzzin.stop" : "buzzin.record");
    btn.classList.toggle("is-recording", !!active);
  }
}

function resetStudentOpenAnswerUi() {
  cancelOpenAnswerRecording();
  openAnswerSubmitting = false;
  openAnswerMine = null;
  openAnswerState = null;
  openAnswerRoundId = null;
  setOpenAnswerRecordingMode(false);
  setOpenAnswerRecordStatus("");
  const topic = openAnswerEl("topic");
  if (topic) topic.textContent = "";
  renderStudentOpenAnswer();
}

function showStudentOpenAnswerResult(mine) {
  const box = openAnswerEl("result");
  if (!box) return;
  const done = mine && mine.analysisStatus !== "pending";
  box.hidden = !mine;
  if (!mine) return;
  box.dataset.verdict = done ? mine.answerVerdict || (mine.analysisStatus === "error" ? "error" : "none") : "pending";
  const verdictKey = {
    correct: "openAnswer.verdictCorrect",
    partial: "openAnswer.verdictPartial",
    incorrect: "openAnswer.verdictIncorrect",
  }[mine.answerVerdict];
  openAnswerEl("verdict").textContent = !done
    ? uiT("openAnswer.checking")
    : mine.analysisStatus === "error"
      ? uiT("openAnswer.checkFailed")
      : verdictKey
        ? uiT(verdictKey)
        : uiT("openAnswer.submitted");
  const points = openAnswerEl("points");
  points.hidden = !(done && mine.points > 0);
  points.textContent = uiT("openAnswer.points", { n: mine.points || 0 });
  openAnswerEl("said").textContent = mine.text || "";
  const feedback = openAnswerEl("feedback");
  feedback.hidden = !(done && mine.spokenFeedback);
  feedback.textContent = mine.spokenFeedback || "";
  const analysis = openAnswerEl("analysis");
  analysis.hidden = !(done && mine.analysisStatus === "done" && mine.analysis);
  analysis.textContent = mine.analysis || "";
}

function renderStudentOpenAnswer() {
  const state = openAnswerState;
  const status = openAnswerEl("status");
  if (!status) return;
  const phase = state?.phase || "ready";
  const answering = phase === "answering";
  const mine = openAnswerMine;
  const timerWrap = openAnswerEl("timer-wrap");
  const area = openAnswerEl("record-area");
  const btn = openAnswerEl("record-btn");

  const topic = openAnswerEl("topic");
  if (topic && state?.topic != null && topic.textContent !== state.topic) topic.textContent = state.topic;
  const progress = openAnswerEl("progress");
  if (progress) {
    progress.hidden = !state || !(state.totalQuestions > 1);
    if (state) progress.textContent = uiT("openAnswer.questionOf", { n: state.questionIndex + 1, total: state.totalQuestions });
  }
  const image = openAnswerEl("image");
  if (image) {
    const src = state?.image && typeof resolvedMediaUrl === "function" ? resolvedMediaUrl(state.image) : state?.image || "";
    image.hidden = !src;
    if (src && image.getAttribute("src") !== src) image.setAttribute("src", src);
  }

  timerWrap.hidden = !answering;
  area.hidden = !(answering && !mine) && !openAnswerBusy();
  if (btn) btn.disabled = openAnswerSubmitting || !answering || openAnswerRemainingMs() <= 0;

  if (openAnswerBusy()) {
    // The record and submit handlers own the status line while they run.
  } else if (mine) {
    status.textContent = answering && state.totalStudents
      ? uiT("openAnswer.waitingOthers", { n: state.submittedCount, total: state.totalStudents })
      : phase === "done"
        ? uiT("openAnswer.waitNext")
        : uiT("openAnswer.submitted");
  } else if (phase === "ready") {
    status.textContent = uiT("openAnswer.waitTeacher");
  } else if (answering) {
    status.textContent = uiT("openAnswer.answerNow");
  } else {
    status.textContent = uiT("openAnswer.noAnswer");
  }
  showStudentOpenAnswerResult(mine);
  updateStudentOpenAnswerTimer();
}

function updateStudentOpenAnswerTimer() {
  const timer = openAnswerEl("timer");
  if (!timer) return;
  const remaining = openAnswerRemainingMs();
  timer.textContent = String(Math.ceil(remaining / 1000));
  openAnswerEl("timer-wrap")?.classList.toggle("is-urgent", remaining > 0 && remaining <= 5000);
  if (remaining <= 0 && openAnswerState?.phase === "answering") {
    const btn = openAnswerEl("record-btn");
    if (btn && !openAnswerBusy()) btn.disabled = true;
  }
}

function startOpenAnswerTicker() {
  if (openAnswerTicker) return;
  openAnswerTicker = setInterval(updateStudentOpenAnswerTimer, 250);
}

function applyStudentOpenAnswerPayload(payload) {
  if (!payload || payload.roundId == null) return;
  if (openAnswerRoundId !== payload.roundId) {
    // A new question: whatever was recorded for the last one is gone.
    if (openAnswerRoundId != null) cancelOpenAnswerRecording();
    openAnswerSubmitting = false;
    setOpenAnswerRecordingMode(false);
    setOpenAnswerRecordStatus("");
    openAnswerRoundId = payload.roundId;
    openAnswerMine = null;
  }
  noteServerClock(payload.serverNow);
  openAnswerState = { ...(openAnswerState || {}), ...payload };
  delete openAnswerState.mine;
  if (payload.mine) openAnswerMine = payload.mine;
  renderStudentOpenAnswer();
}

async function startOpenAnswerRecording() {
  cancelOpenAnswerRecording();
  setOpenAnswerRecordStatus("");
  openAnswerRecorder = createBuzzinPcmRecorder();
  await openAnswerRecorder.start();
  openAnswerRecordStartedAt = Date.now();
  // Stop when the window closes, or after 30 seconds, whichever comes first.
  const limit = Math.max(OPEN_ANSWER_MIN_RECORD_MS, Math.min(OPEN_ANSWER_MAX_RECORD_MS, openAnswerRemainingMs()));
  openAnswerRecordEndsAt = Date.now() + limit;
  const timeEl = openAnswerEl("recording-time");
  const tick = () => {
    if (timeEl) timeEl.textContent = formatOpenAnswerRecordTime(openAnswerRecordEndsAt - Date.now());
  };
  tick();
  openAnswerRecordTicker = setInterval(tick, 250);
  openAnswerRecordTimeout = setTimeout(() => {
    openAnswerRecordTimeout = null;
    if (openAnswerRecorder?.isRecording()) void finishOpenAnswerRecording({ timedOut: true });
  }, limit);
  setOpenAnswerRecordingMode(true);
  openAnswerEl("status").textContent = uiT("buzzin.recordingTitle");
}

async function finishOpenAnswerRecording({ timedOut = false } = {}) {
  if (openAnswerSubmitting) return;
  const recorder = openAnswerRecorder;
  const btn = openAnswerEl("record-btn");
  const status = openAnswerEl("status");
  const say = (message) => {
    setOpenAnswerRecordStatus(message);
    if (status) status.textContent = message;
  };
  if (openAnswerRecordTimeout) clearTimeout(openAnswerRecordTimeout);
  openAnswerRecordTimeout = null;
  stopOpenAnswerRecordTicker();
  setOpenAnswerRecordingMode(false);

  if (!recorder?.isRecording()) {
    say(uiT("buzzin.noAudio"));
    return;
  }
  if (Date.now() - openAnswerRecordStartedAt < OPEN_ANSWER_MIN_RECORD_MS) {
    cancelOpenAnswerRecording();
    say(uiT("buzzin.holdLonger"));
    return;
  }

  openAnswerSubmitting = true;
  if (btn) btn.disabled = true;
  say(timedOut ? uiT("buzzin.timeLimitSubmit") : uiT("buzzin.submitting"));
  const fail = (message) => {
    openAnswerSubmitting = false;
    // The answer can be sent again until the window shuts.
    renderStudentOpenAnswer();
    say(message || uiT("buzzin.submitError"));
  };

  try {
    const wavBlob = await recorder.stop();
    openAnswerRecorder = null;
    openAnswerRecordStartedAt = 0;
    openAnswerRecordEndsAt = 0;
    setOpenAnswerRecordStatus(uiT("buzzin.uploading"));
    const audioBase64 = await blobToWavBase64(wavBlob);
    const socket = getRoomSessionSocket();
    if (!socket?.connected) {
      fail(uiT("buzzin.submitError"));
      return;
    }
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      fail(uiT("buzzin.submitError"));
    }, OPEN_ANSWER_SUBMIT_WAIT_MS);
    socket.emit("submit_openanswer_response", { audioBase64, format: "wav" }, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (!res?.ok) {
        fail(res?.error || uiT("buzzin.submitError"));
        return;
      }
      openAnswerSubmitting = false;
      setOpenAnswerRecordStatus("");
      applyStudentOpenAnswerPayload(res);
    });
  } catch (err) {
    openAnswerRecorder = null;
    openAnswerRecordStartedAt = 0;
    fail(err?.message || uiT("buzzin.submitError"));
  }
}

function requestStudentOpenAnswerState(roomId) {
  if (!roomId) return;
  getRoomSessionSocket().emit("get_openanswer_state", { roomId }, (res) => {
    if (res?.ok && res.active) applyStudentOpenAnswerPayload(res);
  });
}

function ensureStudentOpenAnswerSocket() {
  const socket = getRoomSessionSocket();
  if (socket.__openAnswerBound) return socket;
  socket.__openAnswerBound = true;

  socket.on("openanswer_round_started", (payload) => {
    resetStudentOpenAnswerUi();
    openStudentOpenAnswerScreen();
    applyStudentOpenAnswerPayload(payload);
  });
  for (const event of ["openanswer_opened", "openanswer_update", "openanswer_closed", "openanswer_result"]) {
    socket.on(event, applyStudentOpenAnswerPayload);
  }
  // After a dropped connection the room may have moved on.
  socket.on("connect", () => {
    if ($("#screen-room-openanswer")?.classList.contains("active")) {
      requestStudentOpenAnswerState(roomParticipant?.roomId);
    }
  });

  openAnswerEl("record-btn")?.addEventListener("click", async () => {
    const btn = openAnswerEl("record-btn");
    if (!btn || btn.disabled) return;
    if (openAnswerRecorder?.isRecording()) {
      await finishOpenAnswerRecording();
      return;
    }
    try {
      btn.disabled = true;
      await startOpenAnswerRecording();
      btn.disabled = false;
    } catch (err) {
      btn.disabled = false;
      const message = err?.message || uiT("buzzin.micError");
      setOpenAnswerRecordStatus(message);
      openAnswerEl("status").textContent = message;
    }
  });
  startOpenAnswerTicker();
  return socket;
}

function openStudentOpenAnswerScreen() {
  leaveStudentLiveQuizUi();
  revealStudentScreen("room-openanswer");
}

function showStudentOpenAnswerExercise(exercisePayload) {
  stopRoomStatusPoll();
  stopRoomQuizJoinRetry();
  leaveStudentLiveQuizUi();
  const exercise = exerciseFromSessionRecord(exercisePayload);
  resetStudentOpenAnswerUi();
  const topic = openAnswerEl("topic");
  if (topic) topic.textContent = collectBuzzinQuestions(exercise)[0] || exercise?.title || "";
  revealStudentScreen("room-openanswer");
  const socket = ensureStudentOpenAnswerSocket();
  const roomId = roomParticipant?.roomId;
  if (socket.connected) requestStudentOpenAnswerState(roomId);
  else if (roomId) {
    socket.once("connect", () => requestStudentOpenAnswerState(roomId));
    socket.connect(roomId);
  }
}
