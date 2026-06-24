/**
 * Join page layout preview — enable with ?preview=1 on join.html
 * Switch between exercise screens with sample data for design/dev.
 */
(function initJoinLayoutPreview() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("preview")) return;

  const STORAGE_KEY = "lango_join_preview_layout";
  const TOOLBAR_OPEN_KEY = "lango_join_preview_toolbar_open";

  const LAYOUTS = [
    { id: "join-quiz", label: "Join — Quiz link" },
    { id: "join-room", label: "Join — Class link" },
    { id: "room-waiting", label: "Waiting room" },
    { id: "room-passive-waiting", label: "Passive waiting — video" },
    { id: "mc-question", label: "MC Quiz — question" },
    { id: "mc-answered", label: "MC Quiz — answered" },
    { id: "mc-results", label: "MC Quiz — correct result" },
    { id: "mc-wrong", label: "MC Quiz — wrong result" },
    { id: "finished", label: "Leaderboard" },
    { id: "buzzin-join", label: "Buzz In — buzz window" },
    { id: "buzzin-turn", label: "Buzz In — your turn" },
    { id: "buzzin-wait", label: "Buzz In — waiting turn" },
  ];

  const SAMPLE = {
    options: ["Photosynthesis", "Cellular Respiration", "Decomposition", "Transpiration"],
    question: "What is the process by which plants make their own food?",
    image:
      "https://images.unsplash.com/photo-1558642452-9d2b7bef6b22?w=640&h=360&fit=crop",
    leaderboard: [
      { id: "a", name: "Alex", score: 820 },
      { id: "b", name: "Blake", score: 640 },
      { id: "c", name: "Casey", score: 510 },
      { id: "me", name: "You (preview)", score: 480 },
    ],
  };

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "join-preview-toolbar";
    bar.innerHTML = `
      <p class="join-preview-title">Exercise layout preview</p>
      <label class="join-preview-field">
        <span>Screen</span>
        <select id="join-layout-select"></select>
      </label>
      <p class="join-preview-hint">Add <code>?preview=1</code> to the URL. Socket join is disabled in preview mode.</p>
      <button type="button" class="btn secondary small" id="join-preview-exit">Exit preview</button>
    `;
    document.body.appendChild(bar);

    const toggle = document.createElement("button");
    toggle.className = "join-preview-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-controls", "join-preview-toolbar");
    toggle.setAttribute("aria-label", "Toggle exercise layout preview controls");
    document.body.appendChild(toggle);
    bar.id = "join-preview-toolbar";

    const setToolbarOpen = (open) => {
      bar.classList.toggle("is-hidden", !open);
      document.body.classList.toggle("join-preview-toolbar-open", open);
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Hide preview" : "Show preview";
      localStorage.setItem(TOOLBAR_OPEN_KEY, open ? "1" : "0");
    };

    toggle.addEventListener("click", () => {
      setToolbarOpen(!document.body.classList.contains("join-preview-toolbar-open"));
    });

    setToolbarOpen(localStorage.getItem(TOOLBAR_OPEN_KEY) === "1");

    const layoutSelect = bar.querySelector("#join-layout-select");
    LAYOUTS.forEach(({ id, label }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      layoutSelect.appendChild(opt);
    });

    layoutSelect.addEventListener("change", () => {
      localStorage.setItem(STORAGE_KEY, layoutSelect.value);
      applyLayout(layoutSelect.value);
    });

    bar.querySelector("#join-preview-exit").addEventListener("click", () => {
      const next = new URL(window.location.href);
      next.searchParams.delete("preview");
      next.searchParams.delete("layout");
      window.location.href = next.pathname + next.search;
    });

    return { layoutSelect };
  }

  function showPreviewScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => {
      if (s.id === `screen-${id}`) {
        s.hidden = false;
        s.removeAttribute("aria-hidden");
      }
    });
    showScreen(id);
  }

  function applyLayout(layoutId) {
    switch (layoutId) {
      case "join-quiz":
        $("#join-panel-quiz").hidden = false;
        $("#join-panel-room").hidden = true;
        $("#join-panel-link-required").hidden = true;
        showPreviewScreen("join");
        break;

      case "join-room":
        $("#join-panel-quiz").hidden = true;
        $("#join-panel-room").hidden = false;
        $("#join-panel-link-required").hidden = true;
        $("#join-room-status").textContent = "Joining waiting room…";
        $("#join-room-error").textContent = "";
        showPreviewScreen("join");
        break;

      case "room-waiting":
        $("#room-waiting-status").textContent = "Waiting for the teacher to start…";
        showPreviewScreen("room-waiting");
        break;

      case "room-passive-waiting":
        $("#room-passive-waiting-title").textContent = "Demo: In the Sea";
        $("#room-passive-waiting-status").textContent =
          "No action is needed. Please watch the teacher's screen.";
        showPreviewScreen("room-passive-waiting");
        break;

      case "mc-question":
        resetPlayerMcqAnsweredState();
        showPreviewScreen("player-question");
        $("#player-q-meta").textContent = "Question 1 of 3";
        setQuestionImage(
          $("#player-question-image"),
          $("#player-question-image-wrap"),
          SAMPLE.image
        );
        $("#player-question-text").textContent = SAMPLE.question;
        $("#answer-feedback").textContent = "";
        $("#timer-text").textContent = "12";
        $("#timer-ring").classList.remove("urgent");
        renderOptions($("#player-options"), SAMPLE.options, {
          clickable: true,
          optionLabels: ["A.", "B.", "C.", "D."],
          onClick: (_index, btn) => {
            showPlayerMcqAnsweredState(_index);
            $("#answer-feedback").textContent = "Answer locked in!";
          },
        });
        break;

      case "mc-answered":
        resetPlayerMcqAnsweredState();
        showPreviewScreen("player-question");
        $("#player-q-meta").textContent = "Question 1 of 3";
        $("#player-question-text").textContent = SAMPLE.question;
        $("#answer-feedback").textContent = "Answer locked in!";
        $("#timer-text").textContent = "8";
        renderOptions($("#player-options"), SAMPLE.options, {
          clickable: true,
          optionLabels: ["A.", "B.", "C.", "D."],
        });
        showPlayerMcqAnsweredState(0);
        break;

      case "mc-results":
        showPreviewScreen("player-results");
        renderPlayerMcqResult(
          { playerId: "me", answerIndex: 0, correct: true, points: 500 },
          SAMPLE.leaderboard.map((row) => row.id === "me" ? { ...row, score: 15356 } : row),
          "me"
        );
        break;

      case "mc-wrong":
        showPreviewScreen("player-results");
        renderPlayerMcqResult(
          { playerId: "me", answerIndex: 1, correct: false, points: 0 },
          SAMPLE.leaderboard.map((row) => row.id === "me" ? { ...row, score: 15356 } : row),
          "me"
        );
        break;

      case "finished":
        showPreviewScreen("player-finished");
        showExerciseLeaderboards({
          exerciseLeaderboard: SAMPLE.leaderboard,
          semesterLeaderboard: SAMPLE.leaderboard.map((r, i) => ({
            ...r,
            score: r.score + (3 - i) * 120,
          })),
          highlightId: "me",
          exerciseListEl: $("#player-final-leaderboard"),
          semesterListEl: $("#player-semester-leaderboard"),
          semesterWrapEl: $("#player-semester-leaderboard-wrap"),
          exerciseWrapEl: $("#player-exercise-leaderboard-wrap"),
        });
        $("#btn-play-again").hidden = true;
        break;

      case "buzzin-join":
        showBuzzinLayout({
          topic: "Name an animal that lives in the ocean and say why you like it.",
          phase: "join",
          timer: 18,
          btnEnabled: true,
          status: "Tap BUZZ IN before time runs out!",
        });
        break;

      case "buzzin-turn":
        showBuzzinLayout({
          topic: "Name an animal that lives in the ocean and say why you like it.",
          phase: "turn",
          rank: 2,
          status: "You're #2 — tap Record and speak your answer.",
          showTurn: true,
        });
        break;

      case "buzzin-wait":
        showBuzzinLayout({
          topic: "Name an animal that lives in the ocean and say why you like it.",
          phase: "wait",
          rank: 3,
          status: "You're #3. Waiting for Casey (#2)…",
          buzzed: true,
        });
        break;

      default:
        break;
    }
  }

  function showBuzzinLayout({
    topic,
    phase,
    timer,
    btnEnabled,
    status,
    rank,
    showTurn,
    buzzed,
  }) {
    showPreviewScreen("room-buzzin");
    $("#room-buzzin-topic").textContent = topic;
    $("#room-buzzin-status").textContent = status;

    const timerWrap = $("#room-buzzin-timer-wrap");
    const timerEl = $("#room-buzzin-timer");
    if (phase === "join" && timerWrap && timerEl) {
      timerWrap.hidden = false;
      timerEl.textContent = String(timer);
    } else if (timerWrap) {
      timerWrap.hidden = true;
    }

    const btn = $("#btn-room-buzz-in");
    if (btn) btn.disabled = !btnEnabled;

    const result = $("#room-buzzin-result");
    if (result) {
      if (buzzed && rank) {
        result.hidden = false;
        result.textContent = `You buzzed in #${rank}.`;
        result.className = "buzzin-result buzzin-result--selected";
      } else {
        result.hidden = true;
        result.textContent = "";
      }
    }

    const turnArea = $("#room-buzzin-turn");
    const turnStatus = $("#room-buzzin-turn-status");
    const recordBtn = $("#btn-room-buzzin-record");
    const submitted = $("#room-buzzin-submitted");

    if (showTurn && turnArea) {
      turnArea.hidden = false;
      if (turnStatus) turnStatus.textContent = status;
      if (recordBtn) {
        recordBtn.hidden = false;
        recordBtn.disabled = false;
      }
      if (submitted) submitted.hidden = true;
    } else if (turnArea) {
      turnArea.hidden = true;
      if (recordBtn) recordBtn.hidden = true;
      if (submitted) submitted.hidden = true;
    }
  }

  document.body.classList.add("join-preview-mode");

  const { layoutSelect } = buildToolbar();

  const initial =
    params.get("layout") ||
    localStorage.getItem(STORAGE_KEY) ||
    "mc-question";
  const valid = LAYOUTS.some((l) => l.id === initial);
  layoutSelect.value = valid ? initial : "mc-question";
  applyLayout(layoutSelect.value);
})();
