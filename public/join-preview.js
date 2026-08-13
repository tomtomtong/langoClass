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
    { id: "join-quiz", labelKey: "join.gameTitle" },
    { id: "join-room", labelKey: "join.classTitle" },
    { id: "room-waiting", labelKey: "join.waitingTitle" },
    { id: "room-ended", labelKey: "join.endedTitle" },
    { id: "room-passive-waiting", labelKey: "join.watchTitle" },
    { id: "mc-question", labelKey: "mcq.title" },
    { id: "mc-answered", labelKey: "mcq.answerLocked" },
    { id: "mc-results", labelKey: "mcq.resultCorrect" },
    { id: "mc-wrong", labelKey: "mcq.resultClose" },
    { id: "fast-results", labelKey: "fast.resultTitle" },
    { id: "finished", labelKey: "leaderboard.title" },
    { id: "buzzin-join", labelKey: "buzzin.buzzInBtn" },
    { id: "buzzin-turn", labelKey: "buzzin.youreUp" },
    { id: "buzzin-recording", labelKey: "buzzin.recordingTitle" },
    { id: "buzzin-missed", labelKey: "buzzin.tooLate" },
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

  function previewT(key, vars) {
    return typeof uiT === "function" ? uiT(key, vars) : key;
  }

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "join-preview-toolbar";
    bar.innerHTML = `
      <p class="join-preview-title" data-preview-i18n="preview.title"></p>
      <label class="join-preview-field">
        <span data-preview-i18n="preview.screen"></span>
        <select id="join-layout-select"></select>
      </label>
      <p class="join-preview-hint" data-preview-i18n="preview.hint"></p>
      <div class="join-preview-actions">
        <button type="button" class="btn secondary small" id="join-preview-late-join" data-preview-i18n="preview.lateJoin">Replay late join</button>
        <button type="button" class="btn secondary small" id="join-preview-exit" data-preview-i18n="preview.exit"></button>
      </div>
    `;
    document.body.appendChild(bar);

    const toggle = document.createElement("button");
    toggle.className = "join-preview-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-controls", "join-preview-toolbar");
    document.body.appendChild(toggle);
    bar.id = "join-preview-toolbar";

    const layoutSelect = bar.querySelector("#join-layout-select");

    const fillLayoutOptions = () => {
      const current = layoutSelect.value;
      layoutSelect.innerHTML = "";
      LAYOUTS.forEach(({ id, labelKey }) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = previewT(labelKey);
        layoutSelect.appendChild(opt);
      });
      if (LAYOUTS.some((item) => item.id === current)) layoutSelect.value = current;
    };

    const refreshToolbarCopy = () => {
      bar.querySelectorAll("[data-preview-i18n]").forEach((el) => {
        el.textContent = previewT(el.getAttribute("data-preview-i18n"));
      });
      toggle.setAttribute("aria-label", previewT("preview.toggleAria"));
      const open = document.body.classList.contains("join-preview-toolbar-open");
      toggle.textContent = previewT(open ? "preview.hide" : "preview.show");
      fillLayoutOptions();
    };

    const setToolbarOpen = (open) => {
      bar.classList.toggle("is-hidden", !open);
      document.body.classList.toggle("join-preview-toolbar-open", open);
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = previewT(open ? "preview.hide" : "preview.show");
      localStorage.setItem(TOOLBAR_OPEN_KEY, open ? "1" : "0");
    };

    toggle.addEventListener("click", () => {
      setToolbarOpen(!document.body.classList.contains("join-preview-toolbar-open"));
    });

    fillLayoutOptions();
    refreshToolbarCopy();
    setToolbarOpen(localStorage.getItem(TOOLBAR_OPEN_KEY) === "1");

    layoutSelect.addEventListener("change", () => {
      localStorage.setItem(STORAGE_KEY, layoutSelect.value);
      applyLayout(layoutSelect.value);
    });

    bar.querySelector("#join-preview-late-join").addEventListener("click", () => {
      previewPlayerLateJoin();
    });

    bar.querySelector("#join-preview-exit").addEventListener("click", () => {
      const next = new URL(window.location.href);
      next.searchParams.delete("preview");
      next.searchParams.delete("layout");
      window.location.href = next.pathname + next.search;
    });

    return { layoutSelect, refreshToolbarCopy };
  }

  function showPreviewScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => {
      if (s.id === `screen-${id}`) {
        s.hidden = false;
        s.removeAttribute("aria-hidden");
      }
    });
    showScreen(id, { transition: false });
  }

  function previewPlayerLateJoin() {
    if (typeof showPlayerLateJoinWelcome === "function") {
      showPlayerLateJoinWelcome("Maya Lopez");
    }
  }

  const JOIN_LATE_JOIN_LAYOUTS = new Set([
    "room-waiting",
    "room-passive-waiting",
    "mc-question",
    "mc-answered",
    "mc-results",
    "mc-wrong",
    "fast-results",
    "finished",
    "buzzin-join",
    "buzzin-turn",
    "buzzin-recording",
    "buzzin-missed",
  ]);

  let lateJoinPreviewTimer = 0;

  function scheduleJoinLateJoinPreview(layoutId) {
    window.clearTimeout(lateJoinPreviewTimer);
    if (!JOIN_LATE_JOIN_LAYOUTS.has(layoutId)) return;
    lateJoinPreviewTimer = window.setTimeout(() => {
      previewPlayerLateJoin();
    }, 400);
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
        $("#join-room-status").textContent = previewT("join.joiningRoom");
        $("#join-room-error").textContent = "";
        showPreviewScreen("join");
        break;

      case "room-waiting":
        if (typeof setJoinWaitingStatus === "function") {
          setJoinWaitingStatus("join.inClassWaiting");
        } else {
          $("#room-waiting-status").textContent = previewT("join.inClassWaiting");
        }
        showPreviewScreen("room-waiting");
        break;

      case "room-ended":
        joinEndedStatusKey = "join.endedStatus";
        $("#room-ended-status").textContent = previewT("join.endedStatus");
        if ($("#join-ended-code")) $("#join-ended-code").value = "";
        if ($("#join-ended-error")) $("#join-ended-error").textContent = "";
        if (typeof setEndedSubmitBusy === "function") setEndedSubmitBusy(false);
        if (typeof wireJoinEndedForm === "function") wireJoinEndedForm();
        showPreviewScreen("room-ended");
        break;

      case "room-passive-waiting":
        $("#room-passive-waiting-title").textContent = previewT("join.watchTitle");
        $("#room-passive-waiting-status").textContent = previewT("join.watchStatus");
        showPreviewScreen("room-passive-waiting");
        break;

      case "mc-question":
        resetPlayerMcqAnsweredState();
        showPreviewScreen("player-question");
        $("#player-mcq-title").textContent = previewT("mcq.title");
        $("#player-q-meta").textContent = previewT("mcq.questionOf", { n: 1, total: 3 });
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
            $("#answer-feedback").textContent = previewT("mcq.answerLocked");
          },
        });
        break;

      case "mc-answered":
        resetPlayerMcqAnsweredState();
        showPreviewScreen("player-question");
        $("#player-mcq-title").textContent = previewT("mcq.title");
        $("#player-q-meta").textContent = previewT("mcq.questionOf", { n: 1, total: 3 });
        $("#player-question-text").textContent = SAMPLE.question;
        $("#answer-feedback").textContent = previewT("mcq.answerLocked");
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

      case "fast-results":
        showPreviewScreen("player-fast-results");
        joinLastFastResult = {
          answerReview: Array.from({ length: 10 }, (_, index) => ({
            correctIndex: 1,
            correctAnswer: index % 2 ? "Mitochondria" : "Cellular Respiration",
            options: SAMPLE.options,
          })),
          answerHistory: Array.from({ length: 10 }, (_, index) => [
            { playerId: "me", answerIndex: index % 2 ? 0 : 1, correct: index % 2 === 0 },
          ]),
          leaderboard: SAMPLE.leaderboard.map((row) =>
            row.id === "me" ? { ...row, score: 9850 } : row
          ),
          playerId: "me",
        };
        renderPlayerFastMcResult(joinLastFastResult);
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
          status: previewT("buzzin.tapBuzz"),
        });
        break;

      case "buzzin-turn":
        showBuzzinLayout({
          topic: "Name an animal that lives in the ocean and say why you like it.",
          phase: "turn",
          status: previewT("buzzin.speakAnswer"),
          showTurn: true,
        });
        break;

      case "buzzin-recording":
        showBuzzinLayout({
          topic: "Name an animal that lives in the ocean and say why you like it.",
          phase: "recording",
          status: previewT("buzzin.recordingTitle"),
          showTurn: true,
          recording: true,
        });
        break;

      case "buzzin-missed":
        showBuzzinLayout({
          topic: "",
          phase: "missed",
          cardTitle: previewT("buzzin.tooLate"),
          status: previewT("buzzin.anotherBuzzed"),
        });
        break;

      default:
        break;
    }

    scheduleJoinLateJoinPreview(layoutId);
  }

  function showBuzzinLayout({
    topic,
    phase,
    cardTitle,
    timer,
    btnEnabled,
    status,
    showTurn,
    recording,
  }) {
    showPreviewScreen("room-buzzin");
    $("#room-buzzin-topic").textContent = topic;
    $("#room-buzzin-status").textContent = status;
    $("#screen-room-buzzin")?.classList.toggle("is-recording", !!recording);
    $("#screen-room-buzzin")?.classList.toggle("is-missed", phase === "missed");
    const cardTitleEl = $("#room-buzzin-card-title");
    if (cardTitleEl) {
      cardTitleEl.textContent = recording
        ? previewT("buzzin.recordingTitle")
        : cardTitle || previewT("buzzin.recordTitle");
    }
    const recordingPanel = $("#room-buzzin-recording-panel");
    if (recordingPanel) recordingPanel.hidden = !recording;
    const recordingTime = $("#room-buzzin-recording-time");
    if (recordingTime) recordingTime.textContent = "00 : 30 s";

    const timerWrap = $("#room-buzzin-timer-wrap");
    const timerEl = $("#room-buzzin-timer");
    if (phase === "join" && timerWrap && timerEl) {
      timerWrap.hidden = false;
      timerEl.textContent = String(timer);
    } else if (timerWrap) {
      timerWrap.hidden = true;
    }

    const btn = $("#btn-room-buzz-in");
    if (btn) {
      btn.hidden = phase !== "join";
      btn.disabled = !btnEnabled;
    }

    const result = $("#room-buzzin-result");
    if (result) {
      result.hidden = true;
      result.textContent = "";
    }

    const turnArea = $("#room-buzzin-turn");
    const turnStatus = $("#room-buzzin-turn-status");
    const recordBtn = $("#btn-room-buzzin-record");
    const submitted = $("#room-buzzin-submitted");

    if (showTurn && turnArea) {
      turnArea.hidden = false;
      if (turnStatus) {
        turnStatus.textContent = status;
        turnStatus.hidden = !!recording;
      }
      if (recordBtn) {
        recordBtn.hidden = false;
        recordBtn.disabled = false;
        recordBtn.textContent = recording ? previewT("buzzin.stop") : previewT("buzzin.record");
        recordBtn.classList.toggle("is-recording", !!recording);
      }
      if (submitted) submitted.hidden = true;
    } else if (turnArea) {
      turnArea.hidden = true;
      if (recordBtn) recordBtn.hidden = true;
      if (recordBtn) recordBtn.classList.remove("is-recording");
      if (submitted) submitted.hidden = true;
    }
  }

  document.body.classList.add("join-preview-mode");

  const { layoutSelect, refreshToolbarCopy } = buildToolbar();

  const initial =
    params.get("layout") ||
    localStorage.getItem(STORAGE_KEY) ||
    "mc-question";
  const valid = LAYOUTS.some((l) => l.id === initial);
  layoutSelect.value = valid ? initial : "mc-question";
  applyLayout(layoutSelect.value);

  window.LangoI18n?.onChange?.(() => {
    refreshToolbarCopy();
    applyLayout(layoutSelect.value);
  });
})();
