// Emoji reactions on the join page: a row of emoji buttons; a tap floats that
// emoji up on the host screen (worker/room-reactions.js).
// The bar exists only while the host has reactions on, and join-reactions.css
// shows it on the watch/wait screens only, never over a question's answers.
// It stays closed behind one round button, so a thumb that is only holding the phone or tapping the
// browser's own buttons below cannot send an emoji by mistake: tap the button, then the emoji.
//
// join.js calls:  LangoJoinReactions.attach(socket)  when the session socket is made
//                 LangoJoinReactions.apply(ack)      after join_session succeeds
//                 LangoJoinReactions.hide()          when the class ends
(function () {
  "use strict";

  const SEND_GAP_MS = 700;
  let socket = null;
  let bar = null;
  let toggle = null;
  let closeTimer = null;
  let lastSentAt = 0;
  const OPEN_MS = 8000;

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

  // The reactions show only while the host has opened them: one round button, and the emoji tray
  // above it once it is tapped.
  function render(emojis, emojiOpen) {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "reaction-bar";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Send a reaction to the big screen");
      bar.hidden = true;
      bar.addEventListener("click", onClick);
      document.body.appendChild(bar);
    }
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "reaction-toggle";
      toggle.setAttribute("aria-label", "Reactions");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "😊";
      toggle.addEventListener("click", () => setOpen(bar.hidden));
      document.body.appendChild(toggle);
    }
    if (bar.dataset.emojis !== emojis.join("")) {
      bar.dataset.emojis = emojis.join("");
      bar.innerHTML = emojis
        .map((emoji) => `<button type="button" class="reaction-btn" data-emoji="${emoji}" aria-label="Send ${emoji}">${emoji}</button>`)
        .join("");
    }
    toggle.hidden = !emojiOpen;
    if (!emojiOpen) setOpen(false);
  }

  function setOpen(open) {
    clearTimeout(closeTimer);
    bar.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.classList.toggle("is-open", open);
    toggle.textContent = open ? "✕" : "😊";
    // Closes by itself, so it is never left covering the screen.
    if (open) closeTimer = setTimeout(() => setOpen(false), OPEN_MS);
  }

  function hide() {
    if (bar) setOpen(false);
    if (toggle) toggle.hidden = true;
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
    // The tray stays open a little longer for another one, then tucks itself away.
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setOpen(false), 2500);
  }

  window.LangoJoinReactions = { attach, apply, hide };
})();
