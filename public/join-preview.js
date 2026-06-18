/**
 * Join page layout preview — enable with ?preview=1 on join.html
 * Switch between exercise screens with sample data for design/dev.
 */
(function initJoinLayoutPreview() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("preview")) return;

  const STORAGE_KEY = "lango_join_preview_layout";
  const MCQ_STYLE_KEY = "lango_join_preview_mcq_style";

  const LAYOUTS = [
    { id: "join-quiz", label: "Join — Quiz PIN" },
    { id: "join-room", label: "Join — Room code" },
    { id: "room-waiting", label: "Waiting room" },
    { id: "player-lobby", label: "Quiz lobby" },
    { id: "mc-question", label: "MC Quiz — question" },
    { id: "mc-results", label: "MC Quiz — results" },
    { id: "finished", label: "Exercise complete" },
    { id: "video", label: "Video exercise" },
    { id: "buzzin-join", label: "Buzz In — buzz window" },
    { id: "buzzin-turn", label: "Buzz In — your turn" },
    { id: "buzzin-wait", label: "Buzz In — waiting turn" },
  ];

  const MCQ_STYLES = [
    { id: "classic", label: "Classic grid" },
    { id: "lango", label: "Lango pills" },
  ];

  const SAMPLE = {
    options: ["Honey", "Milk", "Bread", "Jam"],
    question: "What do bees make?",
    image:
      "https://images.unsplash.com/photo-1558642452-9d2b7bef6b22?w=640&h=360&fit=crop",
    leaderboard: [
      { id: "a", name: "Alex", score: 820 },
      { id: "b", name: "Blake", score: 640 },
      { id: "c", name: "Casey", score: 510 },
      { id: "me", name: "You (preview)", score: 480 },
    ],
  };

  let mcqStyle = localStorage.getItem(MCQ_STYLE_KEY) || "classic";

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "join-preview-toolbar";
    bar.innerHTML = `
      <p class="join-preview-title">Exercise layout preview</p>
      <label class="join-preview-field">
        <span>Screen</span>
        <select id="join-layout-select"></select>
      </label>
      <label class="join-preview-field" id="join-mcq-style-field" hidden>
        <span>MC style</span>
        <select id="join-mcq-style-select"></select>
      </label>
      <p class="join-preview-hint">Add <code>?preview=1</code> to the URL. Socket join is disabled in preview mode.</p>
      <button type="button" class="btn secondary small" id="join-preview-exit">Exit preview</button>
    `;
    document.body.appendChild(bar);

    const layoutSelect = bar.querySelector("#join-layout-select");
    LAYOUTS.forEach(({ id, label }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      layoutSelect.appendChild(opt);
    });

    const styleSelect = bar.querySelector("#join-mcq-style-select");
    MCQ_STYLES.forEach(({ id, label }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      styleSelect.appendChild(opt);
    });
    styleSelect.value = mcqStyle;

    layoutSelect.addEventListener("change", () => {
      localStorage.setItem(STORAGE_KEY, layoutSelect.value);
      applyLayout(layoutSelect.value);
    });

    styleSelect.addEventListener("change", () => {
      mcqStyle = styleSelect.value;
      localStorage.setItem(MCQ_STYLE_KEY, mcqStyle);
      applyMcqStyle();
      if (["mc-question", "mc-results"].includes(layoutSelect.value)) {
        applyLayout(layoutSelect.value);
      }
    });

    bar.querySelector("#join-preview-exit").addEventListener("click", () => {
      const next = new URL(window.location.href);
      next.searchParams.delete("preview");
      next.searchParams.delete("layout");
      window.location.href = next.pathname + next.search;
    });

    return { layoutSelect, styleField: bar.querySelector("#join-mcq-style-field") };
  }

  function applyMcqStyle() {
    const screen = document.querySelector("#screen-player-question");
    if (!screen) return;
    screen.classList.toggle("player-mcq-lango", mcqStyle === "lango");
    screen.classList.toggle("player-mcq-classic", mcqStyle === "classic");
  }

  function setMcqStyleFieldVisible(visible, styleField) {
    if (styleField) styleField.hidden = !visible;
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
    const styleField = document.querySelector("#join-mcq-style-field");
    setMcqStyleFieldVisible(["mc-question", "mc-results"].includes(layoutId), styleField);

    switch (layoutId) {
      case "join-quiz":
        $("#join-panel-quiz").hidden = false;
        $("#join-panel-room").hidden = true;
        showPreviewScreen("join");
        break;

      case "join-room":
        $("#join-panel-quiz").hidden = true;
        $("#join-panel-room").hidden = false;
        showPreviewScreen("join");
        break;

      case "room-waiting":
        $("#room-player-name").textContent = "Alex (preview)";
        $("#room-id-display").textContent = "123456";
        $("#room-waiting-status").textContent = "Waiting for the teacher to start…";
        showPreviewScreen("room-waiting");
        break;

      case "player-lobby":
        $("#player-name-display").textContent = "Alex (preview)";
        $("#lobby-status").textContent = "Waiting for host to start…";
        $("#player-quiz-title").textContent = "Demo: Ocean Animals Quiz";
        showPreviewScreen("player-lobby");
        break;

      case "mc-question":
        applyMcqStyle();
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
          onClick: (_index, btn) => {
            $("#player-options").querySelectorAll(".player-btn").forEach((b) => (b.disabled = true));
            btn.classList.add("selected");
            $("#answer-feedback").textContent = "Answer locked in!";
          },
        });
        break;

      case "mc-results":
        applyMcqStyle();
        showPreviewScreen("player-results");
        const msg = $("#player-result-msg");
        msg.textContent = "Correct! +300 points";
        msg.className = "result-msg correct";
        renderLeaderboard($("#player-leaderboard"), SAMPLE.leaderboard, "me");
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
        $("#btn-back-room-waiting").hidden = false;
        $("#btn-play-again").hidden = true;
        break;

      case "video":
        $("#room-video-title").textContent = "Demo: In the Sea";
        $("#room-video-subtitle").textContent = "Watch the lesson on the teacher's screen.";
        $("#room-video-player").hidden = true;
        showPreviewScreen("room-video");
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
          status: "You're #2 — type your answer now.",
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
    const answer = $("#room-buzzin-answer");
    const submitBtn = $("#btn-room-buzzin-submit");
    const submitted = $("#room-buzzin-submitted");

    if (showTurn && turnArea) {
      turnArea.hidden = false;
      if (turnStatus) turnStatus.textContent = status;
      if (answer) {
        answer.hidden = false;
        answer.disabled = false;
        answer.value = "";
      }
      if (submitBtn) {
        submitBtn.hidden = false;
        submitBtn.disabled = false;
      }
      if (submitted) submitted.hidden = true;
    } else if (turnArea) {
      turnArea.hidden = true;
      if (answer) answer.hidden = true;
      if (submitBtn) submitBtn.hidden = true;
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
