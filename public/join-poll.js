// A poll on the join page: one question with no right answer (worker/room-poll.js).
// While the host has a poll open it covers the screen with the question and one big
// button for each option. A student votes once; after that the panel shows their
// choice and sends them back to the big screen, where the bars are.
//
// join.js calls:  LangoJoinPoll.attach(socket)  when the session socket is made
//                 LangoJoinPoll.apply(ack)      after join_session succeeds
//                 LangoJoinPoll.hide()          when the class ends
(function () {
  "use strict";

  let socket = null;
  let panel = null;
  let poll = null; // { id, question, options }
  let myVote = null;

  function attach(nextSocket) {
    socket = nextSocket;
    socket.on("poll_state", show);
  }

  function apply(ack) {
    show(ack?.poll);
  }

  function show(data) {
    if (!data?.open || !Array.isArray(data.options)) {
      hide();
      return;
    }
    if (poll?.id !== data.id) myVote = null;
    if (data.myVote !== null && data.myVote !== undefined) myVote = data.myVote;
    poll = data;
    render();
  }

  function hide() {
    poll = null;
    myVote = null;
    if (panel) panel.hidden = true;
  }

  function render() {
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "poll-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-labelledby", "poll-question");
      // data-i18n keeps the hint right when the class language arrives after the panel.
      panel.innerHTML =
        '<div class="poll-card"><h2 id="poll-question" class="poll-question"></h2>' +
        '<p class="poll-hint" aria-live="polite"></p><div class="poll-options"></div></div>';
      panel.querySelector(".poll-options").addEventListener("click", onClick);
      document.body.appendChild(panel);
    }
    const voted = myVote !== null;
    panel.querySelector(".poll-question").textContent = poll.question;
    const hintKey = voted ? "join.pollThanks" : "join.pollHint";
    const hint = panel.querySelector(".poll-hint");
    hint.dataset.i18n = hintKey;
    hint.textContent = window.LangoI18n?.t?.(hintKey) ?? hintKey;

    const list = panel.querySelector(".poll-options");
    list.textContent = "";
    poll.options.forEach((text, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "poll-option";
      button.dataset.index = String(index);
      button.textContent = text;
      button.disabled = voted;
      if (voted) button.classList.add(index === myVote ? "is-mine" : "is-dim");
      list.appendChild(button);
    });
    panel.hidden = false;
  }

  function onClick(event) {
    const button = event.target.closest(".poll-option");
    if (!button || !socket || !poll || myVote !== null) return;
    const pollId = poll.id;
    myVote = Number(button.dataset.index);
    render();
    const roomId = typeof roomParticipant !== "undefined" ? roomParticipant?.roomId : "";
    socket.emit("send_poll_vote", { roomId, id: pollId, index: myVote }, (res) => {
      if (poll?.id !== pollId) return; // it closed, or another one opened, meanwhile
      myVote = res && res.ok ? res.index : null;
      render();
    });
  }

  window.LangoJoinPoll = { attach, apply, hide };
})();
