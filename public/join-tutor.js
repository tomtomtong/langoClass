// "Raise a hand" on the join page: a ✋ button on the watch screen opens a small panel where
// the student asks Uncle Tommy a question out loud (worker/room-tutor.js). The recording is
// sent as it is; the worker reads it, and the answer plays on the big screen, not here.
//
// The button exists only while the host has questions on (autoclass), shows on the watch
// screen only, and the panel closes by itself if that screen goes away (a question starts),
// so it can never cover a quiz.
//
// join.js calls:  LangoJoinTutor.attach(socket)  when the session socket is made
//                 LangoJoinTutor.apply(ack)      after join_session succeeds
//                 LangoJoinTutor.hide()          when the class ends
(function () {
  "use strict";

  const MIN_MS = 800;
  const MAX_MS = 12000;
  const WATCH_SCREEN = "#screen-room-passive-waiting";

  let socket = null;
  let button = null;
  let panel = null;
  let recorder = null;
  let startedAt = 0;
  let maxTimer = null;
  let tick = null;
  let unlockTimer = null;
  let sending = false;
  let enabled = false;

  function attach(nextSocket) {
    socket = nextSocket;
    socket.on("tutor_state", (data) => apply({ tutor: data }));
    socket.on("ask_status", onStatus);
    new MutationObserver(() => {
      if (panel && !panel.hidden && !document.querySelector(`${WATCH_SCREEN}.active`)) closePanel();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
  }

  function apply(ack) {
    const tutor = ack?.tutor;
    enabled = !!tutor?.enabled;
    if (!enabled) {
      hide();
      return;
    }
    ensureButton();
    button.hidden = false;
    lockFor(tutor.full ? 1e12 : tutor.waitMs || 0);
  }

  function hide() {
    enabled = false;
    if (button) button.hidden = true;
    closePanel();
  }

  function ensureButton() {
    if (button) return;
    button = document.createElement("button");
    button.type = "button";
    button.className = "tutor-ask-btn";
    // data-i18n keeps the label right when the class language arrives after the button.
    button.innerHTML = '<span class="tutor-ask-hand" aria-hidden="true">✋</span><span class="tutor-ask-label" data-i18n="join.askButton"></span>';
    setText(button.querySelector(".tutor-ask-label"), "join.askButton");
    button.addEventListener("click", openPanel);
    document.body.appendChild(button);
  }

  // After a question the button waits out the server's gap between one student's questions.
  function lockFor(ms) {
    clearTimeout(unlockTimer);
    if (!button) return;
    button.disabled = ms > 0;
    button.classList.toggle("is-waiting", ms > 0);
    if (ms > 0 && ms < 1e11) unlockTimer = setTimeout(() => lockFor(0), ms);
  }

  function t(key) {
    return window.LangoI18n?.t?.(key) ?? key;
  }

  function setText(element, key) {
    element.dataset.i18n = key;
    element.textContent = t(key);
  }

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = "tutor-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "tutor-title");
    panel.innerHTML =
      '<div class="tutor-card">' +
      '<button type="button" class="tutor-close">✕</button>' +
      '<h2 id="tutor-title" class="tutor-title" data-i18n="join.askTitle"></h2>' +
      '<button type="button" class="tutor-mic" aria-label="🎤"><span aria-hidden="true">🎤</span></button>' +
      '<p class="tutor-status" aria-live="polite"></p>' +
      '<p class="tutor-heard" hidden></p>' +
      "</div>";
    panel.querySelector(".tutor-close").setAttribute("aria-label", t("join.askClose"));
    panel.querySelector(".tutor-close").addEventListener("click", closePanel);
    panel.querySelector(".tutor-mic").addEventListener("click", onMic);
    document.body.appendChild(panel);
    setText(panel.querySelector(".tutor-title"), "join.askTitle");
  }

  function status(key) {
    setText(panel.querySelector(".tutor-status"), key);
  }

  function openPanel() {
    if (!enabled || button?.disabled || !document.querySelector(`${WATCH_SCREEN}.active`)) return;
    ensurePanel();
    resetPanel();
    panel.hidden = false;
  }

  function resetPanel() {
    sending = false;
    panel.classList.remove("is-recording", "is-sending", "is-done");
    panel.querySelector(".tutor-mic").disabled = false;
    panel.querySelector(".tutor-heard").hidden = true;
    status("join.askIdle");
  }

  function closePanel() {
    clearTimeout(maxTimer);
    clearInterval(tick);
    if (recorder) {
      recorder.cancel();
      recorder = null;
    }
    if (panel) panel.hidden = true;
  }

  async function onMic() {
    if (sending) return;
    if (recorder?.isRecording()) {
      await finish();
      return;
    }
    try {
      recorder = createBuzzinPcmRecorder();
      await recorder.start();
    } catch {
      recorder = null;
      status("join.askMic");
      return;
    }
    startedAt = Date.now();
    panel.classList.add("is-recording");
    status("join.askRecording");
    clearTimeout(maxTimer);
    maxTimer = setTimeout(finish, MAX_MS);
  }

  async function finish() {
    clearTimeout(maxTimer);
    const active = recorder;
    recorder = null;
    if (!active?.isRecording()) return;
    panel.classList.remove("is-recording");
    if (Date.now() - startedAt < MIN_MS) {
      active.cancel();
      status("join.askTooShort");
      return;
    }
    sending = true;
    panel.classList.add("is-sending");
    panel.querySelector(".tutor-mic").disabled = true;
    status("join.askSending");
    try {
      const audioBase64 = await blobToWavBase64(await active.stop());
      if (!socket?.connected) throw new Error("offline");
      const roomId = typeof roomParticipant !== "undefined" ? roomParticipant?.roomId : "";
      socket.emit("ask_question", { roomId, audioBase64, format: "wav" }, onAck);
    } catch {
      sending = false;
      panel.classList.remove("is-sending");
      panel.querySelector(".tutor-mic").disabled = false;
      status("join.askFailed");
    }
  }

  function onAck(res) {
    if (!panel || panel.hidden) return;
    panel.classList.remove("is-sending");
    if (res?.ok) {
      panel.classList.add("is-done");
      const heard = panel.querySelector(".tutor-heard");
      heard.textContent = `“${res.text}”`;
      heard.hidden = false;
      status("join.askWait");
      lockFor(res.waitMs || 0);
      return;
    }
    sending = false;
    panel.querySelector(".tutor-mic").disabled = false;
    if (res?.waitMs) {
      lockFor(res.waitMs);
      status("join.askAgainLater");
    } else {
      status(/hear/i.test(res?.error || "") ? "join.askNotHeard" : "join.askFailed");
    }
  }

  // The worker says when Tommy has the question, can't answer it, is busy with others, or failed.
  function onStatus(data) {
    if (!data) return;
    // Its turn did not come: the question is let go and the student may ask again at once, even
    // if they have closed the panel.
    if (data.state === "later") lockFor(0);
    if (!panel || panel.hidden) return;
    if (data.state === "answering") status("join.askAnswering");
    else if (data.state === "declined") status("join.askDeclined");
    else if (data.state === "failed") status("join.askFailed");
    else if (data.state === "queued") status("join.askQueued");
    else if (data.state === "later") {
      status("join.askLater");
      sending = false;
      panel.classList.remove("is-sending", "is-done");
      panel.querySelector(".tutor-mic").disabled = false;
      panel.querySelector(".tutor-heard").hidden = true;
    }
  }

  window.LangoJoinTutor = { attach, apply, hide };
})();
