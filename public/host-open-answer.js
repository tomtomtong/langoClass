/**
 * Host side of "Everyone Answers": Uncle Tommy reads the question, the host
 * opens a timed window, every student records an answer, and the board fills
 * in as each answer is marked. The room (worker/room-open-answer.js) sends
 * the host every answer and the answer key; students only get their own.
 */
let hostOpenAnswerRoomId = null;
let hostOpenAnswerPayload = null;
let hostOpenAnswerSpeaking = false;
let hostOpenAnswerBusy = false;
let hostOpenAnswerTicker = null;
let hostOpenAnswerKeyShown = false;
let hostOpenAnswerKeyRound = null;

function hostOpenAnswerEl(id) {
  return $(`#host-openanswer-${id}`);
}

function hostOpenAnswerRemainingSeconds() {
  const payload = hostOpenAnswerPayload;
  if (!payload || payload.phase !== "answering") return 0;
  return Math.max(0, Math.ceil((serverTimeToLocal(payload.endsAt) - Date.now()) / 1000));
}

function hostOpenAnswerSetStatus(text) {
  const el = hostOpenAnswerEl("status");
  if (el) el.textContent = text || "";
}

function hostOpenAnswerVerdictLabel(entry) {
  if (entry.analysisStatus === "pending") return uiT("openAnswer.checking");
  if (entry.analysisStatus === "error") return uiT("openAnswer.checkFailed");
  const key = {
    correct: "openAnswer.verdictCorrect",
    partial: "openAnswer.verdictPartial",
    incorrect: "openAnswer.verdictIncorrect",
  }[entry.answerVerdict];
  return key ? uiT(key) : uiT("openAnswer.submitted");
}

function renderHostOpenAnswerList(payload) {
  const list = hostOpenAnswerEl("list");
  if (!list) return;
  const responses = [...(payload.responses || [])].sort((a, b) => (a.at || 0) - (b.at || 0));
  hostOpenAnswerEl("board")?.toggleAttribute("hidden", !responses.length);
  list.innerHTML = responses
    .map((entry, index) => {
      const verdict = entry.analysisStatus === "done" ? entry.answerVerdict || "none" : entry.analysisStatus;
      const points = entry.points > 0 ? `<span class="host-openanswer-points">${escapeHtml(uiT("openAnswer.points", { n: entry.points }))}</span>` : "";
      const play = entry.responseAudio
        ? `<button type="button" class="host-openanswer-play" data-index="${index}" aria-label="${escapeHtml(uiT("openAnswer.playRecording"))}">▶</button>`
        : "";
      const feedback = entry.spokenFeedback
        ? `<p class="host-openanswer-row-feedback">${escapeHtml(entry.spokenFeedback)}</p>`
        : "";
      return `<li class="host-openanswer-row" data-verdict="${escapeHtml(verdict)}">
        <span class="host-openanswer-avatar" style="--avatar-hue: ${buzzinAvatarHue(entry.displayName)}" aria-hidden="true">${escapeHtml(buzzinAvatarInitials(entry.displayName))}</span>
        <span class="host-openanswer-row-body">
          <span class="host-openanswer-row-head">
            <strong>${escapeHtml(entry.displayName)}</strong>
            <span class="host-openanswer-verdict">${escapeHtml(hostOpenAnswerVerdictLabel(entry))}</span>
            ${points}
          </span>
          <span class="host-openanswer-said">${escapeHtml(entry.text)}</span>
          ${feedback}
        </span>
        ${play}
      </li>`;
    })
    .join("");
  list.querySelectorAll(".host-openanswer-play").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = responses[Number(btn.dataset.index)];
      if (entry) void playBuzzinResponseRecordingAudio(entry).catch(() => {});
    });
  });
}

function renderHostOpenAnswer() {
  const payload = hostOpenAnswerPayload;
  if (!payload) return;
  const phase = payload.phase;
  const topic = hostOpenAnswerEl("topic");
  if (topic && topic.textContent !== payload.topic) topic.textContent = payload.topic;
  const progress = hostOpenAnswerEl("progress");
  if (progress) {
    progress.hidden = !(payload.totalQuestions > 1);
    progress.textContent = uiT("openAnswer.questionOf", { n: payload.questionIndex + 1, total: payload.totalQuestions });
  }
  const image = hostOpenAnswerEl("image");
  if (image) {
    const src = payload.image && typeof resolvedMediaUrl === "function" ? resolvedMediaUrl(payload.image) : payload.image || "";
    image.hidden = !src;
    if (src && image.getAttribute("src") !== src) image.setAttribute("src", src);
  }
  $("#screen-host-openanswer")?.classList.toggle("has-image", Boolean(payload.image));

  hostOpenAnswerEl("timer-wrap").hidden = phase !== "answering";
  hostOpenAnswerEl("count").textContent = uiT("openAnswer.answeredCount", {
    n: payload.submittedCount,
    total: payload.totalStudents,
  });

  const open = hostOpenAnswerEl("open-btn");
  open.hidden = phase !== "ready";
  open.disabled = hostOpenAnswerSpeaking || hostOpenAnswerBusy;
  open.classList.toggle("is-ready", phase === "ready" && !hostOpenAnswerSpeaking);
  hostOpenAnswerEl("close-btn").hidden = phase !== "answering";

  const key = hostOpenAnswerEl("answer-key");
  const showKey = hostOpenAnswerEl("show-answer-btn");
  if (hostOpenAnswerKeyRound !== payload.roundId) {
    hostOpenAnswerKeyRound = payload.roundId;
    hostOpenAnswerKeyShown = false;
  }
  const hasKey = Boolean(payload.correctAnswer);
  showKey.hidden = !(phase === "done" && hasKey && !hostOpenAnswerKeyShown);
  key.hidden = !(hasKey && hostOpenAnswerKeyShown);
  key.textContent = hasKey ? uiT("openAnswer.answerKey", { answer: payload.correctAnswer }) : "";

  const next = hostOpenAnswerEl("next-btn");
  next.hidden = phase !== "done";
  const label = next.querySelector(".host-btn-label");
  if (label) label.textContent = uiT(payload.hasNextQuestion ? "openAnswer.nextQuestion" : "openAnswer.finish");

  if (hostOpenAnswerSpeaking) hostOpenAnswerSetStatus(uiT("buzzin.uncleReading"));
  else if (phase === "ready") hostOpenAnswerSetStatus(uiT("openAnswer.hostReady"));
  else if (phase === "answering") hostOpenAnswerSetStatus(uiT("openAnswer.hostAnswering"));
  else hostOpenAnswerSetStatus(uiT(payload.closeReason === "all" ? "openAnswer.everyoneAnswered" : "openAnswer.hostClosed"));

  renderHostOpenAnswerList(payload);
  updateHostOpenAnswerTimer();
}

function updateHostOpenAnswerTimer() {
  const timer = hostOpenAnswerEl("timer");
  if (!timer) return;
  const seconds = hostOpenAnswerRemainingSeconds();
  timer.textContent = String(seconds);
  hostOpenAnswerEl("timer-wrap")?.classList.toggle("is-urgent", seconds > 0 && seconds <= 5);
}

function applyHostOpenAnswerPayload(payload) {
  if (!payload || payload.roundId == null) return;
  noteServerClock(payload.serverNow);
  hostOpenAnswerPayload = payload;
  renderHostOpenAnswer();
}

async function hostOpenAnswerEmit(event, data = {}) {
  const socket = getHostSessionSocket();
  if (!socket.connected) {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", () => reject(new Error("Could not connect to room.")));
      socket.connect(hostOpenAnswerRoomId);
    });
  }
  return new Promise((resolve, reject) => {
    socket.emit(event, { roomId: hostOpenAnswerRoomId, ...data }, (res) => {
      if (res?.ok) resolve(res);
      else reject(new Error(res?.error || "Request failed."));
    });
  });
}

function bindHostOpenAnswerSocket(socket) {
  if (socket.__hostOpenAnswerBound) return;
  socket.__hostOpenAnswerBound = true;
  for (const event of [
    "openanswer_round_started",
    "openanswer_opened",
    "openanswer_update",
    "openanswer_closed",
  ]) {
    socket.on(event, applyHostOpenAnswerPayload);
  }
  hostOpenAnswerTicker = hostOpenAnswerTicker || setInterval(updateHostOpenAnswerTimer, 250);
}

// Asks the room for the (next) question, reads it aloud, then lets the host
// open the window.
async function hostOpenAnswerStartQuestion(event) {
  hostOpenAnswerSpeaking = true;
  hostOpenAnswerBusy = true;
  hostOpenAnswerKeyShown = false;
  if (hostOpenAnswerPayload) {
    hostOpenAnswerPayload = { ...hostOpenAnswerPayload, phase: "ready", responses: [], submittedCount: 0 };
    renderHostOpenAnswer();
  }
  hostOpenAnswerSetStatus(uiT("buzzin.uncleReading"));
  try {
    const res = await hostOpenAnswerEmit(event);
    applyHostOpenAnswerPayload(res);
    try {
      if (res.topicAudio) await playHostUncleTommyTts(res.topicAudio, res.topicAudioFormat || "mp3");
    } catch (err) {
      console.warn(err?.message || "Could not play the question audio.");
    }
  } finally {
    hostOpenAnswerSpeaking = false;
    hostOpenAnswerBusy = false;
    renderHostOpenAnswer();
  }
}

async function showHostOpenAnswerExercise(exercise, roomId) {
  const topics = collectBuzzinQuestions(exercise);
  if (!topics.length) throw new Error("No Everyone Answers content in this exercise.");
  hostOpenAnswerRoomId = roomId;
  hostOpenAnswerPayload = null;
  hostOpenAnswerKeyRound = null;
  hostOpenAnswerEl("topic").textContent = topics[0];
  hostOpenAnswerEl("list").innerHTML = "";
  hostOpenAnswerEl("board").hidden = true;
  hostOpenAnswerEl("timer-wrap").hidden = true;
  hostOpenAnswerEl("open-btn").hidden = false;
  hostOpenAnswerEl("open-btn").disabled = true;
  hostOpenAnswerEl("close-btn").hidden = true;
  hostOpenAnswerEl("next-btn").hidden = true;
  hostOpenAnswerEl("show-answer-btn").hidden = true;
  hostOpenAnswerEl("answer-key").hidden = true;
  hostOpenAnswerEl("count").textContent = "";
  const pointsEl = hostOpenAnswerEl("points");
  if (pointsEl) pointsEl.textContent = uiT("openAnswer.upTo", { n: 300 });
  if (typeof refreshNextExerciseUi === "function") refreshNextExerciseUi();
  showScreen("host-openanswer");
  bindHostOpenAnswerSocket(getHostSessionSocket());
  if (typeof connectHostSession === "function") await connectHostSession(roomId);
  await hostOpenAnswerStartQuestion("start_openanswer_round");
}

async function hostOpenAnswerOpenWindow() {
  if (hostOpenAnswerBusy) return;
  hostOpenAnswerBusy = true;
  hostOpenAnswerEl("open-btn").disabled = true;
  try {
    applyHostOpenAnswerPayload(await hostOpenAnswerEmit("open_openanswer_window"));
  } catch (err) {
    hostOpenAnswerSetStatus(err?.message || "Could not open answers.");
  } finally {
    hostOpenAnswerBusy = false;
    renderHostOpenAnswer();
  }
}

async function hostOpenAnswerCloseWindow() {
  try {
    applyHostOpenAnswerPayload(await hostOpenAnswerEmit("close_openanswer_window"));
  } catch (err) {
    hostOpenAnswerSetStatus(err?.message || "Could not close answers.");
  }
}

async function hostOpenAnswerNext() {
  if (hostOpenAnswerBusy) return;
  if (!hostOpenAnswerPayload?.hasNextQuestion) {
    if (typeof finishVideoOrBuzzinExercise === "function") finishVideoOrBuzzinExercise();
    return;
  }
  try {
    await hostOpenAnswerStartQuestion("next_openanswer_question");
  } catch (err) {
    hostOpenAnswerSetStatus(err?.message || "Could not open the next question.");
  }
}

function initHostOpenAnswerUi() {
  hostOpenAnswerEl("open-btn")?.addEventListener("click", () => {
    if (typeof playPageNextSound === "function") playPageNextSound();
    void hostOpenAnswerOpenWindow();
  });
  hostOpenAnswerEl("close-btn")?.addEventListener("click", () => void hostOpenAnswerCloseWindow());
  hostOpenAnswerEl("show-answer-btn")?.addEventListener("click", () => {
    hostOpenAnswerKeyShown = true;
    renderHostOpenAnswer();
  });
  hostOpenAnswerEl("next-btn")?.addEventListener("click", () => {
    if (typeof playPageNextSound === "function") playPageNextSound();
    void hostOpenAnswerNext();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHostOpenAnswerUi);
} else {
  initHostOpenAnswerUi();
}
