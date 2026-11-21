// Emoji reactions on the join page: a row of emoji buttons; a tap floats that
// emoji up on the host screen (worker/room-reactions.js).
// The bar exists only while the host has reactions on, and join-reactions.css
// shows it on the watch/wait screens only, never over a question's answers.
//
// With it comes an "I don't get it" button, on the watch screen only. The host
// screen shows how many students pressed it, never who (send_lost).
//
// join.js calls:  LangoJoinReactions.attach(socket)  when the session socket is made
//                 LangoJoinReactions.apply(ack)      after join_session succeeds
//                 LangoJoinReactions.hide()          when the class ends
(function () {
  "use strict";

  const SEND_GAP_MS = 700;
  // How long one press counts on the host screen (autoclass.js LOST_WINDOW_MS); the
  // button stays "sent" for the same time.
  const LOST_HOLD_MS = 20000;
  let socket = null;
  let bar = null;
  let lostButton = null;
  let lostTimer = null;
  let lastSentAt = 0;

  function attach(nextSocket) {
    socket = nextSocket;
    socket.on("reactions_state", apply);
  }

  function apply(data) {
    if (data && "reactions" in data) data = { enabled: data.reactions, emojis: data.reactionEmojis, emojiOpen: data.reactionEmojiOpen };
    if (!data?.enabled || !Array.isArray(data.emojis) || !data.emojis.length) {
      hide();
      return;
    }
    render(data.emojis, !!data.emojiOpen);
  }

  // The "I don't get it" button shows all through the lesson; the emoji bar only while the host has
  // opened it. The other buttons sit lower while it is closed (--emoji-h, used by the CSS).
  function render(emojis, emojiOpen) {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "reaction-bar";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Send a reaction to the big screen");
      bar.addEventListener("click", onClick);
      document.body.appendChild(bar);
    }
    if (bar.dataset.emojis !== emojis.join("")) {
      bar.dataset.emojis = emojis.join("");
      bar.innerHTML = emojis
        .map((emoji) => `<button type="button" class="reaction-btn" data-emoji="${emoji}" aria-label="Send ${emoji}">${emoji}</button>`)
        .join("");
    }
    bar.hidden = !emojiOpen;
    document.body.style.setProperty("--emoji-h", emojiOpen ? "82px" : "0px"); // the bar (68px) and a 14px gap

    if (!lostButton) {
      lostButton = document.createElement("button");
      lostButton.type = "button";
      lostButton.className = "lost-btn";
      // data-i18n keeps the label right when the class language arrives after the button.
      lostButton.innerHTML = '<span aria-hidden="true">🤔</span><span class="lost-btn-label" data-i18n="join.lostButton"></span>';
      lostButton.addEventListener("click", onLostClick);
      document.body.appendChild(lostButton);
      setLostSent(false);
    }
    lostButton.hidden = false;
  }

  function hide() {
    document.body.style.setProperty("--emoji-h", "0px");
    if (bar) bar.hidden = true;
    if (lostButton) lostButton.hidden = true;
  }

  function roomId() {
    return typeof roomParticipant !== "undefined" ? roomParticipant?.roomId : "";
  }

  function setLostSent(sent) {
    clearTimeout(lostTimer);
    lostTimer = sent ? setTimeout(() => setLostSent(false), LOST_HOLD_MS) : null;
    const key = sent ? "join.lostSent" : "join.lostButton";
    const label = lostButton.querySelector(".lost-btn-label");
    label.dataset.i18n = key;
    label.textContent = window.LangoI18n?.t?.(key) ?? key;
    lostButton.classList.toggle("is-sent", sent);
    lostButton.disabled = sent;
  }

  function onLostClick() {
    if (!socket || lostButton.disabled) return;
    setLostSent(true);
    socket.emit("send_lost", { roomId: roomId() }, (res) => {
      if (res && res.ok === false) setLostSent(false);
    });
  }

  function onClick(event) {
    const button = event.target.closest(".reaction-btn");
    if (!button || !socket) return;
    const now = Date.now();
    if (now - lastSentAt < SEND_GAP_MS) return;
    lastSentAt = now;
    socket.emit("send_reaction", { roomId: roomId(), emoji: button.dataset.emoji }, () => {});
    button.classList.remove("is-sent");
    void button.offsetWidth;
    button.classList.add("is-sent");
  }

  window.LangoJoinReactions = { attach, apply, hide };
})();
