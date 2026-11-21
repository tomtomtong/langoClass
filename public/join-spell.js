// A spelling race on the join page (worker/room-spell.js). While the race is open it covers the
// screen: an emoji, empty boxes for the word, and its letters as scrambled tiles. Tap a tile to
// put it in the next box, tap a box to take its letter back. When every box is full the phone
// sends the word; a right word moves on to the next, a wrong one shakes and empties. "Skip" moves
// on and comes back to the word later. When the race ends the panel shows the words.
//
// join.js calls:  LangoJoinSpell.attach(socket)  when the session socket is made
//                 LangoJoinSpell.apply(ack)      after join_session succeeds
//                 LangoJoinSpell.hide()          when the class ends
(function () {
  "use strict";

  const SHOW_ANSWERS_MS = 12000;
  const NEXT_WORD_MS = 650;
  const WRONG_MS = 600;

  let socket = null;
  let panel = null;
  let race = null; // { id, puzzles: [{ emoji, hint, letters }], seconds, deadline }
  let solved = new Set();
  let points = 0;
  let current = 0;
  let filled = []; // tile indexes, in the order tapped
  let busy = false;
  let answers = null; // [{ word, emoji }] once the race has ended
  let tick = 0;
  let hideTimer = 0;

  const t = (key, vars) => window.LangoI18n?.t?.(key, vars) ?? key;

  function attach(nextSocket) {
    socket = nextSocket;
    socket.on("spell_state", onState);
  }

  function apply(ack) {
    if (ack?.spell) onState(ack.spell);
  }

  function onState(data) {
    if (!data) return;
    if (!data.open) {
      if (race && data.id === race.id && Array.isArray(data.words)) showAnswers(data.words);
      else hide();
      return;
    }
    if (!Array.isArray(data.puzzles) || !data.puzzles.length) return;
    const fresh = race?.id !== data.id;
    race = {
      id: data.id,
      puzzles: data.puzzles,
      seconds: data.seconds || 60,
      deadline: Date.now() + (Number(data.msLeft) || 0),
    };
    if (fresh) {
      solved = new Set();
      points = 0;
      current = 0;
    }
    (data.solved || []).forEach((index) => solved.add(index));
    if (data.points) points = data.points;
    answers = null;
    filled = [];
    busy = false;
    window.clearTimeout(hideTimer);
    if (solved.has(current)) current = nextUnsolved(current);
    ensurePanel();
    startClock();
    render();
  }

  function hide() {
    race = null;
    answers = null;
    stopClock();
    window.clearTimeout(hideTimer);
    if (panel) panel.hidden = true;
  }

  function showAnswers(words) {
    answers = words;
    stopClock();
    render();
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, SHOW_ANSWERS_MS);
  }

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = "spell-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", t("join.spellTitle"));
    panel.innerHTML =
      '<div class="spell-card">' +
      '<div class="spell-top"><span class="spell-count"></span><span class="spell-points"></span></div>' +
      '<div class="spell-timer" aria-hidden="true"><span class="spell-timer-fill"></span></div>' +
      '<div class="spell-play">' +
      '<div class="spell-emoji" aria-hidden="true"></div>' +
      '<p class="spell-hint"></p>' +
      '<div class="spell-slots"></div>' +
      '<div class="spell-tiles"></div>' +
      '<button type="button" class="spell-skip"></button>' +
      "</div>" +
      '<div class="spell-message" aria-live="polite"></div>' +
      '<ul class="spell-answers"></ul>' +
      "</div>";
    panel.querySelector(".spell-tiles").addEventListener("click", onTile);
    panel.querySelector(".spell-slots").addEventListener("click", onSlot);
    panel.querySelector(".spell-skip").addEventListener("click", onSkip);
    document.body.appendChild(panel);
  }

  function timeUp() {
    return !race || Date.now() >= race.deadline;
  }

  function allSolved() {
    return !!race && solved.size >= race.puzzles.length;
  }

  function nextUnsolved(from) {
    const count = race.puzzles.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (from + step) % count;
      if (!solved.has(index)) return index;
    }
    return from;
  }

  function render() {
    if (!panel || !race) return;
    panel.hidden = false;
    const total = race.puzzles.length;
    panel.querySelector(".spell-count").textContent = t("join.spellCount", { n: solved.size, total });
    panel.querySelector(".spell-points").textContent = t("join.spellPoints", { n: points });

    const playing = !answers && !timeUp() && !allSolved();
    panel.querySelector(".spell-play").hidden = !playing;
    panel.querySelector(".spell-timer").hidden = !!answers;
    const message = panel.querySelector(".spell-message");
    const list = panel.querySelector(".spell-answers");
    list.textContent = "";
    list.hidden = !answers;

    if (answers) {
      message.textContent = t("join.spellAnswers");
      answers.forEach((entry, index) => {
        const item = document.createElement("li");
        item.className = solved.has(index) ? "is-solved" : "";
        item.textContent = `${entry.emoji || ""} ${entry.word}`.trim();
        list.appendChild(item);
      });
      return;
    }
    if (!playing) {
      message.textContent = allSolved() ? t("join.spellAllDone") : t("join.spellTimeUp");
      return;
    }
    message.textContent = "";

    const puzzle = race.puzzles[current];
    panel.querySelector(".spell-emoji").textContent = puzzle.emoji || "❓";
    const hint = panel.querySelector(".spell-hint");
    hint.textContent = puzzle.hint || t("join.spellHint");

    const slots = panel.querySelector(".spell-slots");
    slots.textContent = "";
    puzzle.letters.forEach((_, i) => {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "spell-slot";
      slot.dataset.slot = String(i);
      const tile = filled[i];
      slot.textContent = tile === undefined ? "" : puzzle.letters[tile];
      slot.disabled = tile === undefined || busy;
      slot.setAttribute("aria-label", tile === undefined ? t("join.spellEmptyBox") : puzzle.letters[tile]);
      slots.appendChild(slot);
    });

    const tiles = panel.querySelector(".spell-tiles");
    tiles.textContent = "";
    puzzle.letters.forEach((letter, i) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "spell-tile";
      tile.dataset.tile = String(i);
      tile.textContent = letter;
      const used = filled.includes(i);
      tile.classList.toggle("is-used", used);
      tile.disabled = used || busy;
      tiles.appendChild(tile);
    });

    const skip = panel.querySelector(".spell-skip");
    skip.textContent = t("join.spellSkip");
    skip.hidden = total - solved.size < 2;
    skip.disabled = busy;
  }

  function onTile(event) {
    const tile = event.target.closest(".spell-tile");
    if (!tile || busy || !race) return;
    const index = Number(tile.dataset.tile);
    if (filled.includes(index)) return;
    filled.push(index);
    if (filled.length === race.puzzles[current].letters.length) submit();
    else render();
  }

  function onSlot(event) {
    const slot = event.target.closest(".spell-slot");
    if (!slot || busy) return;
    filled.splice(Number(slot.dataset.slot), 1);
    render();
  }

  function onSkip() {
    if (busy || !race) return;
    current = nextUnsolved(current);
    filled = [];
    render();
  }

  function submit() {
    const raceId = race.id;
    const index = current;
    const puzzle = race.puzzles[index];
    const answer = filled.map((tile) => puzzle.letters[tile]).join("");
    busy = true;
    render();
    const roomId = typeof roomParticipant !== "undefined" ? roomParticipant?.roomId : "";
    socket.emit("send_spell", { roomId, id: raceId, index, answer }, (res) => {
      if (race?.id !== raceId) return;
      const slots = panel.querySelector(".spell-slots");
      if (res?.ok && res.correct) {
        solved.add(index);
        points = res.points ?? points;
        slots.classList.add("is-right");
        window.setTimeout(() => {
          slots.classList.remove("is-right");
          if (race?.id !== raceId) return;
          busy = false;
          filled = [];
          if (!allSolved()) current = nextUnsolved(index);
          render();
        }, NEXT_WORD_MS);
        return;
      }
      if (res && !res.ok) {
        // The race closed while this word was on its way; the spell_state that follows shows the words.
        busy = false;
        render();
        return;
      }
      slots.classList.add("is-wrong");
      window.setTimeout(() => {
        slots.classList.remove("is-wrong");
        busy = false;
        filled = [];
        render();
      }, WRONG_MS);
    });
  }

  function startClock() {
    stopClock();
    const fill = panel.querySelector(".spell-timer-fill");
    const step = () => {
      if (!race) return;
      const left = Math.max(0, race.deadline - Date.now());
      fill.style.transform = `scaleX(${left / (race.seconds * 1000)})`;
      panel.querySelector(".spell-timer").classList.toggle("is-low", left < 10000);
      if (left <= 0) {
        stopClock();
        render();
      }
    };
    step();
    tick = window.setInterval(step, 250);
  }

  function stopClock() {
    window.clearInterval(tick);
    tick = 0;
  }

  window.LangoJoinSpell = { attach, apply, hide };
})();
