/**
 * Host page layout preview — enable with ?preview=1 on host.html
 * Switch between host screens with sample data for design/dev.
 * Legacy: ?preview=leaderboard opens the leaderboard layout directly.
 */
(function initHostLayoutPreview() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("preview")) return;

  const STORAGE_KEY = "lango_host_preview_layout";
  const TOOLBAR_OPEN_KEY = "lango_host_preview_toolbar_open";

  const LAYOUTS = [
    { id: "login", label: "Login" },
    { id: "class", label: "Class selection" },
    { id: "course", label: "Course selection" },
    { id: "section", label: "Section road" },
    { id: "section-exercises", label: "Section — exercise panel" },
    { id: "waiting", label: "Waiting room" },
    { id: "mc-preview", label: "MC Quiz — preview" },
    { id: "mc-question", label: "MC Quiz — question" },
    { id: "mc-fast", label: "MC Quiz — fast mode" },
    { id: "mc-results", label: "MC Quiz — results" },
    { id: "fast-results", label: "MC Quiz — fast accuracy" },
    { id: "leaderboard", label: "Leaderboard — session" },
    { id: "leaderboard-overall", label: "Leaderboard — overall" },
    { id: "video", label: "Video exercise" },
    { id: "buzzin-ready", label: "Buzz In — waiting to start" },
    { id: "buzzin-join", label: "Buzz In — buzz window" },
    { id: "buzzin-responses", label: "Buzz In — answer & feedback" },
  ];

  const SAMPLE = {
    question: "What is the process by which plants make their own food?",
    options: ["Photosynthesis", "Cellular Respiration", "Decomposition", "Transpiration"],
    image:
      "https://images.unsplash.com/photo-1558642452-9d2b7bef6b22?w=640&h=360&fit=crop",
    buzzTopic: "Name an animal that lives in the ocean and say why you like it.",
    classItem: { id: 1, name: "Explorer Class A", class_name: "Explorer Class A", student_count: 18 },
    classes: [
      { id: 1, name: "Explorer Class A", class_name: "Explorer Class A", student_count: 18, level: "Beginner" },
      { id: 2, name: "Explorer Class B", class_name: "Explorer Class B", student_count: 16, level: "Beginner" },
      { id: 3, name: "Adventure Class A", class_name: "Adventure Class A", student_count: 14, level: "Intermediate" },
      { id: 4, name: "Adventure Class B", class_name: "Adventure Class B", student_count: 12, level: "Intermediate" },
    ],
    course: {
      id: 1,
      title: "Ocean Adventures",
      description: "Explore marine life, habitats, and conservation.",
      exerciseCount: 5,
      banner: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=640&h=360&fit=crop",
    },
    courses: [
      {
        id: 1,
        title: "Ocean Adventures",
        description: "Explore marine life, habitats, and conservation.",
        exerciseCount: 5,
        banner: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=640&h=360&fit=crop",
      },
      {
        id: 2,
        title: "Space Explorers",
        description: "Planets, stars, and the science of the cosmos.",
        exerciseCount: 4,
        banner: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=640&h=360&fit=crop",
      },
      {
        id: 3,
        title: "World Cultures",
        description: "Traditions, food, and festivals around the globe.",
        exerciseCount: 6,
      },
    ],
    sections: [
      {
        id: 1,
        title: "In the Sea",
        order: 1,
        banner: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=480&h=320&fit=crop",
        exercises: [
          { id: 101, title: "Ocean MC Quiz", type: "mcquiz", order: 1, subTitle: "Choose the correct answer.", items: [{}, {}, {}] },
          { id: 102, title: "Coral Reef Video", type: "video", order: 2, subTitle: "Watch the lesson video.", videoUrl: "" },
          { id: 103, title: "Marine Buzz In", type: "buzzin", order: 3, subTitle: "First to buzz in answers." },
          { id: 104, title: "Fast MC", type: "fastmcquiz", order: 4, subTitle: "Answer quickly — results at the end.", items: [{}, {}, {}, {}, {}] },
          { id: 105, title: "Image Assignment", type: "imageassignment", order: 5, subTitle: "Match words to images." },
          { id: 106, title: "Voice Assignment", type: "voiceassignment", order: 6, subTitle: "Speak and check pronunciation." },
        ],
      },
      {
        id: 2,
        title: "Deep Dive",
        order: 2,
        banner: "https://images.unsplash.com/photo-1583212292454-1fe622960057?w=480&h=320&fit=crop",
        exercises: [
          { id: 201, title: "Fast Facts Quiz", type: "fastmcquiz", order: 1, subTitle: "Answer quickly — results at the end.", items: [{}, {}, {}, {}, {}] },
        ],
      },
      {
        id: 3,
        title: "Conservation",
        order: 3,
        exercises: [
          { id: 301, title: "Protect the Ocean", type: "mcquiz", order: 1, items: [{}, {}] },
        ],
      },
      {
        id: 4,
        title: "Tide Pools",
        order: 4,
        banner: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=480&h=320&fit=crop",
        exercises: [
          { id: 401, title: "Tiny Habitats", type: "video", order: 1, subTitle: "Explore life near the shore.", videoUrl: "" },
        ],
      },
      {
        id: 5,
        title: "Ocean Food Chain",
        order: 5,
        exercises: [
          { id: 501, title: "Who Eats What?", type: "mcquiz", order: 1, subTitle: "Choose the right food chain.", items: [{}, {}, {}] },
        ],
      },
      {
        id: 6,
        title: "Sea Creatures",
        order: 6,
        banner: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=480&h=320&fit=crop",
        exercises: [
          { id: 601, title: "Creature Buzz", type: "buzzin", order: 1, subTitle: "Name a creature and describe it." },
        ],
      },
      {
        id: 7,
        title: "Ocean Sounds",
        order: 7,
        exercises: [
          { id: 701, title: "Listen and Speak", type: "voiceassignment", order: 1, subTitle: "Practice ocean vocabulary." },
        ],
      },
      {
        id: 8,
        title: "Ships and Navigation",
        order: 8,
        banner: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=480&h=320&fit=crop",
        exercises: [
          { id: 801, title: "Map the Route", type: "imageassignment", order: 1, subTitle: "Match images to directions." },
        ],
      },
      {
        id: 9,
        title: "Blue Planet Review",
        order: 9,
        exercises: [
          { id: 901, title: "Speed Review", type: "fastmcquiz", order: 1, subTitle: "Quick review challenge.", items: [{}, {}, {}, {}] },
        ],
      },
      {
        id: 10,
        title: "Ocean Mission",
        order: 10,
        banner: "https://images.unsplash.com/photo-1439405326854-014607f694d7?w=480&h=320&fit=crop",
        exercises: [
          { id: 1001, title: "Final Mission", type: "mcquiz", order: 1, subTitle: "Complete the journey.", items: [{}, {}, {}, {}] },
        ],
      },
    ],
    participants: [
      { id: "p1", userId: "s1", displayName: "Sophia Patel" },
      { id: "p2", userId: "s2", displayName: "Liam Chen" },
      { id: "p3", userId: "s3", displayName: "Ava Williams" },
      { id: "p4", userId: "s4", displayName: "Emma Smith" },
      { id: "p5", userId: "s5", displayName: "Noah Brown" },
    ],
    roster: [
      { id: "s1", fullName: "Sophia Patel" },
      { id: "s2", fullName: "Liam Chen" },
      { id: "s3", fullName: "Ava Williams" },
      { id: "s4", fullName: "Emma Smith" },
      { id: "s5", fullName: "Noah Brown" },
      { id: "s6", fullName: "Olivia Davis" },
    ],
    leaderboard: [
      { id: "sophia", name: "Sophia Patel", score: 10850 },
      { id: "liam", name: "Liam Chen", score: 10240 },
      { id: "ava", name: "Ava Williams", score: 9780 },
      { id: "emma", name: "Emma Smith", score: 9450 },
      { id: "noah", name: "Noah Brown", score: 8875 },
      { id: "olivia", name: "Olivia Davis", score: 8200 },
      { id: "james", name: "James Miller", score: 7750 },
      { id: "isabella", name: "Isabella Garcia", score: 7100 },
    ],
    quizResults: [
      { name: "Sophia Patel", correct: true },
      { name: "Liam Chen", correct: true },
      { name: "Ava Williams", correct: true },
      { name: "Emma Smith", correct: false },
      { name: "Noah Brown", correct: false },
    ],
    fastResults: [
      { name: "Sophia Patel", correctAnswers: 5 },
      { name: "Liam Chen", correctAnswers: 4 },
      { name: "Ava Williams", correctAnswers: 4 },
      { name: "Emma Smith", correctAnswers: 3 },
      { name: "Noah Brown", correctAnswers: 2 },
      { name: "Olivia Davis", correctAnswers: 1 },
    ],
    buzzes: [{ rank: 1, displayName: "Sophia Patel", playerId: "p1", at: Date.now() - 1700 }],
    buzzResponses: [
      {
        rank: 1,
        playerId: "p1",
        displayName: "Sophia Patel",
        text: "I like dolphins because they are smart and playful.",
        analysis: "Great answer, Sophia! I would give you 285 points! 🎉",
        analysisStatus: "done",
      },
    ],
  };

  SAMPLE.sections[0].exercises[2].topic = SAMPLE.buzzTopic;

  function seedPreviewState() {
    state.classItem = { ...SAMPLE.classItem, studentList: SAMPLE.roster };
    state.course = SAMPLE.course;
    state.courses = SAMPLE.courses;
    state.sections = SAMPLE.sections;
    state.selectedSection = SAMPLE.sections[0];
    state.selectedExercise = SAMPLE.sections[0].exercises[0];
    state.user = { name: "Preview Teacher", username: "preview" };
    state.hostProgress = { completedExerciseIds: [101], lastSectionId: 1, lastExerciseId: 101 };
    state.waitingTotalTarget = SAMPLE.roster.length;
    state.activeRoomId = "482916";
  }

  function showHostPreviewScreen(screenId, stepId) {
    if (typeof clearTimer === "function") clearTimer();
    if (screenId !== "section" || stepId !== "journey") {
      if (typeof setSectionExercisePanelVisible === "function") {
        setSectionExercisePanelVisible(false);
      }
    }
    if (typeof activateScreen === "function") activateScreen(screenId);
    else showScreen(screenId);
    if (typeof setActiveStep === "function") setActiveStep(stepId);
  }

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "join-preview-toolbar";
    bar.innerHTML = `
      <p class="join-preview-title">Host layout preview</p>
      <label class="join-preview-field">
        <span>Screen</span>
        <select id="host-layout-select"></select>
      </label>
      <p class="join-preview-hint">Add <code>?preview=1</code> to the URL. Login and socket sessions are disabled in preview mode.</p>
      <button type="button" class="btn secondary small" id="host-preview-exit">Exit preview</button>
    `;
    document.body.appendChild(bar);

    const toggle = document.createElement("button");
    toggle.className = "join-preview-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-controls", "host-preview-toolbar");
    toggle.setAttribute("aria-label", "Toggle host layout preview controls");
    document.body.appendChild(toggle);
    bar.id = "host-preview-toolbar";

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

    const layoutSelect = bar.querySelector("#host-layout-select");
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

    bar.querySelector("#host-preview-exit").addEventListener("click", () => {
      const next = new URL(window.location.href);
      next.searchParams.delete("preview");
      next.searchParams.delete("layout");
      window.location.href = next.pathname + next.search;
    });

    return { layoutSelect };
  }

  function renderPreviewLeaderboard(view = "current") {
    const overall = SAMPLE.leaderboard.map((row, index) => ({
      ...row,
      score: row.score + (8 - index) * 10000,
    }));

    showExerciseLeaderboards({
      exerciseLeaderboard: SAMPLE.leaderboard,
      semesterLeaderboard: overall,
      exerciseListEl: $("#host-quiz-final-leaderboard"),
      semesterListEl: $("#host-semester-leaderboard"),
      semesterWrapEl: $("#host-semester-leaderboard-wrap"),
      exerciseWrapEl: $("#host-exercise-leaderboard-wrap"),
    });

    $("#btn-host-quiz-next-exercise")?.setAttribute("hidden", "");

    if (view === "overall") {
      $("#host-leaderboard-overall-tab")?.click();
    }
  }

  function applyLayout(layoutId) {
    seedPreviewState();

    switch (layoutId) {
      case "login":
        showHostPreviewScreen("login", "login");
        break;

      case "class":
        renderClassGrid($("#class-sections"), SAMPLE.classes, { selectedId: 1, onSelect: () => {} });
        $("#class-status").textContent = "";
        $("#class-error").textContent = "";
        $("#teacher-label-wrap").hidden = false;
        $("#teacher-label").textContent = "Preview Teacher";
        showHostPreviewScreen("class", "class");
        break;

      case "course":
        renderCourseGrid($("#course-sections"), SAMPLE.courses, { selectedId: 1, onSelect: () => {} });
        $("#course-status").textContent = "";
        $("#course-error").textContent = "";
        $("#class-label").textContent = SAMPLE.classItem.name;
        updateCourseCountBadge(SAMPLE.courses.length);
        showHostPreviewScreen("course", "course");
        break;

      case "section":
        renderSectionPicker();
        showHostPreviewScreen("section", "section");
        break;

      case "section-exercises": {
        renderSectionPicker();
        const exercises = SAMPLE.sections[0].exercises;
        state.selectedExercise = exercises[1];
        setSectionExercisePanelVisible(true);
        $("#journey-status").textContent = "";
        $("#journey-error").textContent = "";
        $("#exercise-list").innerHTML = exercises
          .map((exercise, index) =>
            renderExerciseItem(exercise, index, state.selectedExercise.id, {
              locked: false,
              completed: index === 0,
            })
          )
          .join("");
        $("#btn-start-session").disabled = false;
        initExerciseLotties();
        showHostPreviewScreen("section", "journey");
        break;
      }

      case "waiting":
        updateWaitingUserName();
        $("#waiting-room-id").textContent = "482916";
        $("#waiting-timer-value").textContent = "03 : 45";
        renderParticipants(SAMPLE.participants);
        $("#waiting-error").textContent = "";
        showHostPreviewScreen("waiting", "waiting");
        initWaitingClockLottie();
        break;

      case "mc-preview":
        renderHostQuizPreview({
          questionIndex: 0,
          totalQuestions: 3,
          text: SAMPLE.question,
          image: SAMPLE.image,
          points: 300,
          previewSeconds: 5,
          previewEndsAt: Date.now() + 5000,
        });
        setActiveStep("quiz");
        break;

      case "mc-question":
        const fromMcPreview = $("#screen-host-quiz-preview")?.classList.contains("active");
        renderHostQuizQuestion(
          {
            questionIndex: 0,
            totalQuestions: 3,
            text: SAMPLE.question,
            options: SAMPLE.options,
            image: SAMPLE.image,
            points: 300,
            timeLimit: 15,
            endsAt: Date.now() + 15000,
          },
          { preparing: false, transition: !fromMcPreview }
        );
        setActiveStep("quiz");
        break;

      case "mc-fast":
        renderHostQuizQuestion({
          questionIndex: 1,
          totalQuestions: 5,
          text: SAMPLE.question,
          options: SAMPLE.options,
          image: "",
          points: 500,
          fastMode: true,
          timeLimit: 8,
          endsAt: Date.now() + 8000,
        });
        setActiveStep("quiz");
        break;

      case "mc-results": {
        roomQuizCurrentQuestion = {
          questionIndex: 0,
          totalQuestions: 3,
          text: SAMPLE.question,
          options: SAMPLE.options,
          image: SAMPLE.image,
          points: 300,
        };
        showHostPreviewScreen("host-quiz-results", "quiz");
        setQuestionImage(
          $("#host-quiz-results-image"),
          $("#host-quiz-results-image-wrap"),
          SAMPLE.image
        );
        $("#host-quiz-results-points").textContent = "300 pts";
        $("#host-quiz-results-question-text").textContent = SAMPLE.question;
        const correctAnswerEl = $("#host-quiz-results-correct-answer");
        if (correctAnswerEl) {
          correctAnswerEl.innerHTML =
            'Correct Answer: <span class="host-mcq-correct-highlight">A. Photosynthesis</span>';
        }
        renderHostResultDistribution(roomQuizCurrentQuestion, [3, 1, 1, 0], 0);
        renderCorrectResponders(SAMPLE.quizResults);
        renderLeaderboard($("#host-quiz-leaderboard"), SAMPLE.leaderboard.slice(0, 5));
        $("#btn-host-quiz-next").textContent = "Next question";
        break;
      }

      case "fast-results":
        renderFastAccuracyLeaderboard(SAMPLE.fastResults, 5);
        showHostPreviewScreen("host-fast-results", "quiz");
        break;

      case "leaderboard":
        renderPreviewLeaderboard("current");
        showHostPreviewScreen("host-quiz-finished", "quiz");
        break;

      case "leaderboard-overall":
        renderPreviewLeaderboard("overall");
        showHostPreviewScreen("host-quiz-finished", "quiz");
        break;

      case "video":
        $("#host-video-title").textContent = "Coral Reef Video";
        $("#host-video-subtitle").textContent = "Watch the lesson video.";
        $("#host-video-current").textContent = "1:24";
        $("#host-video-duration").textContent = "4:30";
        $("#host-video-scrubber")?.style.setProperty("--host-video-progress", "31%");
        $("#screen-host-video")?.classList.add("has-subtitle");
        $("#screen-host-video")?.classList.remove("has-video");
        showHostPreviewScreen("host-video", "quiz");
        break;

      case "buzzin-ready":
        showHostPreviewScreen("host-buzzin", "quiz");
        syncHostBuzzinTopic(SAMPLE.buzzTopic);
        $("#host-buzzin-points").textContent = "300 pts";
        updateHostBuzzinUi({
          phase: "ready",
          topic: SAMPLE.buzzTopic,
          joinSeconds: 20,
          totalBuzzes: 0,
          buzzes: [],
        });
        break;

      case "buzzin-join":
        showHostPreviewScreen("host-buzzin", "quiz");
        syncHostBuzzinTopic(SAMPLE.buzzTopic);
        $("#host-buzzin-points").textContent = "300 pts";
        updateHostBuzzinUi({
          phase: "join",
          joinSeconds: 20,
          joinSecondsRemaining: 14,
          joinEndsAt: Date.now() + 14000,
          totalBuzzes: 0,
          buzzes: [],
        });
        break;

      case "buzzin-responses":
        resetHostBuzzinFeedbackAnim();
        showHostPreviewScreen("host-buzzin-feedback", "quiz");
        triggerHostBuzzinFeedbackEnter();
        syncHostBuzzinTopic(SAMPLE.buzzTopic);
        $("#host-buzzin-points").textContent = "300 pts";
        updateHostBuzzinUi({
          phase: "done",
          topic: SAMPLE.buzzTopic,
          joinSeconds: 20,
          joinEndsAt: Date.now() + 5000,
          totalBuzzes: 1,
          buzzes: SAMPLE.buzzes,
          winners: SAMPLE.buzzes,
          responses: SAMPLE.buzzResponses,
          typingComplete: true,
        });
        break;

      default:
        break;
    }
  }

  document.body.classList.add("join-preview-mode");

  const { layoutSelect } = buildToolbar();

  const previewParam = params.get("preview");
  const initial =
    params.get("layout") ||
    (previewParam === "1" ? "mc-preview" : localStorage.getItem(STORAGE_KEY)) ||
    (previewParam === "leaderboard" ? "leaderboard" : "mc-preview");
  const valid = LAYOUTS.some((layout) => layout.id === initial);
  layoutSelect.value = valid ? initial : "mc-question";
  applyLayout(layoutSelect.value);
})();
