// Emoji reactions on the join page: a row of emoji buttons; a tap floats that
// emoji up on the host screen (worker/room-reactions.js).
// The bar exists only while the host has reactions on, and join-reactions.css
// shows it on the watch/wait screens only, never over a question's answers.
//
// join.js calls:  LangoJoinReactions.attach(socket)  when the session socket is made
//                 LangoJoinReactions.apply(ack)      after join_session succeeds
//                 LangoJoinReactions.hide()          when the class ends
(function () {
  "use strict";

  const SEND_GAP_MS = 700;
  let socket = null;
  let bar = null;
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

  // The emoji bar shows only while the host has opened it (--emoji-h, used by the CSS).
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
  }

  function hide() {
    document.body.style.setProperty("--emoji-h", "0px");
    if (bar) bar.hidden = true;
  }

  function roomId() {
    return typeof roomParticipant !== "undefined" ? roomParticipant?.roomId : "";
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
