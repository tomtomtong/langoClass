const STORAGE_KEY = "lango_host_prefs";
const LEGACY_STORAGE_KEY = "lango_host_session";
const HOST_STAGE_WIDTH = 1920;
const HOST_STAGE_HEIGHT = 1080;

const state = {
  token: null,
  user: null,
  loginUsername: "",
  classItem: null,
  classes: [],
  course: null,
  courses: [],
  sections: [],
  selectedSection: null,
  exercises: [],
  selectedExercise: null,
  activeRoomId: null,
  sessionStarted: false,
  quizActive: false,
  waitingTotalTarget: 0,
};

let hostSessionConnected = false;
let waitingTimerInterval = null;
const WAITING_TIMER_SECONDS = 300;

function fitHostStage() {
  const app = document.querySelector("#app.lango-host");
  if (!app) return;
  const viewport = window.visualViewport || window;
  const width = viewport.width || window.innerWidth || HOST_STAGE_WIDTH;
  const height = viewport.height || window.innerHeight || HOST_STAGE_HEIGHT;
  const scale = Math.min(width / HOST_STAGE_WIDTH, height / HOST_STAGE_HEIGHT);
  app.style.setProperty("--host-stage-scale", String(scale));
}

window.addEventListener("resize", fitHostStage);
window.visualViewport?.addEventListener("resize", fitHostStage);
fitHostStage();

function loadPrefs() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = sessionStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.loginUsername) state.loginUsername = data.loginUsername;
    if (data.token && data.user) {
      state.token = data.token;
      state.user = data.user;
    }
    if (data.classItem?.id) state.classItem = data.classItem;
    if (data.course?.id) state.course = data.course;
    if (data.selectedSection?.id) state.selectedSection = data.selectedSection;
  } catch {
    /* ignore */
  }
}

function savePrefs() {
  const loginUsername =
    $("#login-username")?.value.trim().toLowerCase() || state.loginUsername || "";
  if (loginUsername) state.loginUsername = loginUsername;

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      loginUsername: state.loginUsername,
      token: state.token,
      user: state.user,
      classItem: state.classItem,
      course: state.course,
      selectedSection: state.selectedSection,
    })
  );
}

function applyLoginUsernameToForm() {
  if (state.loginUsername) {
    $("#login-username").value = state.loginUsername;
  }
}

function clearAuth() {
  state.token = null;
  state.user = null;
  savePrefs();
}

function findCourseInList(courseId) {
  if (!courseId) return null;
  return state.courses.find((c) => c.id === courseId) || null;
}

function findSectionInList(sectionId) {
  if (!sectionId) return null;
  return state.sections.find((s) => s.id === sectionId) || null;
}

function sectionTitle(section) {
  return section?.title || "Section";
}

function getSelectedSectionExercises() {
  if (!state.selectedSection) return [];
  const section =
    findSectionInList(state.selectedSection.id) ||
    state.sections.find((s) => s.id === state.selectedSection?.id) ||
    state.selectedSection;
  return [...(section.exercises || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function getNextExerciseAfter(exercise) {
  const exercises = getSelectedSectionExercises();
  const idx = exercises.findIndex((e) => e.id === exercise?.id);
  if (idx < 0 || idx >= exercises.length - 1) return null;
  return exercises[idx + 1];
}

function refreshNextExerciseUi() {
  const next = getNextExerciseAfter(state.selectedExercise);
  const label = next ? next.title || `Exercise ${next.id}` : null;

  for (const id of [
    "btn-host-quiz-next-exercise",
    "btn-host-video-next-exercise",
    "btn-host-buzzin-next-exercise",
  ]) {
    const btn = $("#" + id);
    if (!btn) continue;
    if (label) {
      btn.hidden = false;
      btn.textContent = `Next exercise: ${label}`;
    } else {
      btn.hidden = true;
    }
  }
}

function teacherDisplayName() {
  if (!state.user) return "";
  const u = state.user;
  if (u.firstName || u.lastName) {
    return [u.firstName, u.lastName].filter(Boolean).join(" ");
  }
  return u.username || u.email || `User #${u.id}`;
}

function courseBanner(course) {
  return (
    course?.banner ||
    course?.bannerUrl ||
    course?.image ||
    course?.thumbnail ||
    course?.cover ||
    ""
  );
}

function sectionBanner(section) {
  return (
    section?.banner ||
    section?.bannerUrl ||
    section?.thumbnail ||
    section?.image ||
    ""
  );
}

function courseTitle(course) {
  return course?.name || course?.title || course?.courseName || "Whiteboard session";
}

async function renderRoomJoinLinks(roomId) {
  const wrap = $("#waiting-join-links-wrap");
  const list = $("#waiting-join-links");
  if (!wrap || !list || !roomId) {
    if (wrap) wrap.hidden = true;
    return;
  }

  const links = [];
  const path = `/join.html?room=${encodeURIComponent(roomId)}`;
  links.push({ label: "This device", url: `${window.location.origin}${path}` });

  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";

  try {
    const res = await fetch("/api/network-urls");
    const { port, addresses, publicBaseUrl } = await res.json();
    if (publicBaseUrl) {
      links.push({
        label: "Student join link",
        url: `${publicBaseUrl.replace(/\/$/, "")}${path}`,
      });
    }
    if (isLocal && addresses?.length) {
      for (const ip of addresses) {
        links.push({
          label: `Phone on Wi‑Fi (${ip})`,
          url: `http://${ip}:${port}${path}`,
        });
      }
    }
  } catch {
    /* ignore */
  }

  list.innerHTML = links
    .map(
      (l) =>
        `<li><span class="link-label">${escapeHtml(l.label)}</span><a href="${escapeHtml(l.url)}">${escapeHtml(l.url)}</a></li>`
    )
    .join("");
  wrap.hidden = false;
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (state.user?.id) headers["X-Teacher-Id"] = String(state.user.id);
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || res.statusText };
  }

  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      (typeof data === "string" ? data : null) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  if (data && data.status === false) {
    throw new Error(data.message || "API returned status false");
  }

  return data;
}

function setActiveStep(stepId) {
  document.querySelectorAll(".flow-steps .step").forEach((el) => {
    el.classList.toggle("active", el.dataset.step === stepId);
    const order = ["login", "class", "course", "section", "journey", "waiting", "quiz"];
    const idx = order.indexOf(stepId);
    const elIdx = order.indexOf(el.dataset.step);
    el.classList.toggle("done", elIdx >= 0 && elIdx < idx);
  });
}

function goTo(screenId, stepId) {
  showScreen(screenId);
  setActiveStep(stepId);
}

function renderClassCard(classItem, { selectedId, onSelect }) {
  const active = classItem.id === selectedId ? " active" : "";
  const title = classItem.name || classItem.class_name || `Class ${classItem.id}`;
  const studentCount = classStudentCount(classItem);
  const meta =
    studentCount != null
      ? `${studentCount} student${studentCount === 1 ? "" : "s"}`
      : "";

  return `<button type="button" class="class-card${active}" data-id="${classItem.id}">
    <span class="class-card-shine" aria-hidden="true"></span>
    <span class="class-card-name">${escapeHtml(title)}</span>
    ${meta ? `<span class="class-card-meta">${escapeHtml(meta)}</span>` : ""}
  </button>`;
}

function courseDescription(course) {
  const description = course?.description ? String(course.description).trim() : "";
  if (description) return description;
  const count = course?.exerciseCount || 0;
  if (count) {
    return `${count} exercise${count === 1 ? "" : "s"} in this course.`;
  }
  return "Choose this course to continue your journey.";
}

function courseLevelLabel() {
  const level = getClassLevelLabel(state.classItem);
  if (!level || level === "Classes") {
    return state.classItem?.name ? `Class — ${state.classItem.name}` : "";
  }
  return `English level — ${level}`;
}

function sectionDescription(section) {
  const count = (section.exercises || []).length;
  if (count) {
    return `${count} exercise${count === 1 ? "" : "s"} in this section.`;
  }
  return "Choose this section to continue your journey.";
}

function sectionXpValue(section) {
  return (section.exercises || []).length * 10;
}

function updateSectionCountBadge(count) {
  const badge = $("#section-count-badge");
  if (!badge) return;
  if (!count) {
    badge.hidden = true;
    badge.textContent = "";
    return;
  }
  badge.hidden = false;
  badge.textContent = `${count} section${count === 1 ? "" : "s"} ready to play`;
}

function updateSectionProgressCard(sections, selectedId = state.selectedSection?.id) {
  const card = $("#section-current-progress");
  if (!card) return;

  const sortedSections = [...(sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const total = sortedSections.length;
  if (!total) {
    card.hidden = true;
    return;
  }

  const selectedIndex = sortedSections.findIndex((section) => section.id === selectedId);
  const playableCount = sortedSections.filter((section) => (section.exercises || []).length > 0).length;
  const completed = selectedIndex >= 0 ? selectedIndex + 1 : playableCount;
  const clampedCompleted = Math.min(Math.max(completed, 0), total);
  const percent = Math.round((clampedCompleted / total) * 100);
  const progressDeg = percent * 3.6;

  $("#section-current-progress-completed").textContent = String(clampedCompleted);
  $("#section-current-progress-total").textContent = String(total);
  $("#section-current-progress-pct").textContent = `${percent}%`;
  $("#section-current-progress-ring").style.setProperty("--section-current-progress", `${progressDeg}deg`);
  card.hidden = false;
}

function setSectionExercisePanelVisible(visible) {
  const overlay = $("#section-exercise-overlay");
  const scene = document.querySelector("#screen-section .section-scene");
  if (overlay) overlay.hidden = !visible;
  if (scene) scene.classList.toggle("section-scene--exercises-open", visible);
}

function closeSectionExercises() {
  setSectionExercisePanelVisible(false);
}

function renderSectionPickCard(section, { selectedId, index }) {
  const active = section.id === selectedId ? " active" : "";
  const banner = sectionBanner(section);
  const exerciseCount = (section.exercises || []).length;
  const hasExercises = exerciseCount > 0;
  const thumb = banner
    ? `<img class="course-pick-thumb" src="${escapeHtml(banner)}" alt="" />`
    : `<div class="course-pick-thumb course-pick-thumb--empty" aria-hidden="true"></div>`;
  const playButton = hasExercises
    ? `<button type="button" class="course-pick-select" data-id="${section.id}">
          Start
        </button>`
    : `<button type="button" class="course-pick-select course-pick-select--disabled" data-id="${section.id}" disabled>
          Start
        </button>`;

  return `<article class="course-pick-card${active}${hasExercises ? "" : " course-pick-card--empty"}" data-id="${section.id}" style="--card-i: ${index}">
    <div class="course-pick-card-inner">
      ${thumb}
      <div class="course-pick-body">
        ${playButton}
      </div>
    </div>
  </article>`;
}

function renderSectionPickerGrid(container, sections, { selectedId, onSelect }) {
  if (!container) return;
  if (!sections.length) {
    container.className = "section-road";
    container.innerHTML = "";
    return;
  }

  container.className = "section-road";
  container.innerHTML = renderSectionRoad(sections, { selectedId });

  container.querySelectorAll(".course-pick-select").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(Number(btn.dataset.id));
    });
  });
}

const SECTION_ROAD_POINTS = [
  { x: 9, y: 21 },
  { x: 39, y: 66 },
  { x: 58, y: 54 },
  { x: 74, y: 37 },
  { x: 87, y: 23 },
  { x: 96, y: 20 },
];

function sectionRoadPoint(index, total) {
  if (total <= SECTION_ROAD_POINTS.length) {
    return SECTION_ROAD_POINTS[index] || SECTION_ROAD_POINTS[SECTION_ROAD_POINTS.length - 1];
  }
  const progress = total <= 1 ? 0 : index / (total - 1);
  const wave = Math.sin(progress * Math.PI * 2.5);
  return {
    x: 10 + progress * 80,
    y: 55 - wave * 16 - progress * 14,
  };
}

function renderSectionRoad(sections, { selectedId }) {
  const trackWidth = Math.max(220, (sections.length - 1) * 360 + 220);
  const bridgeCount = Math.max(0, sections.length - 1);
  const bridges = Array.from({ length: bridgeCount }, (_, index) => renderSectionRoadBridge(index))
    .join("");
  const cards = sections
    .map((section, index) => renderSectionRoadCard(section, { selectedId, index }))
    .join("");

  return `<div class="section-road-shell" aria-label="Course sections">
    <div class="section-road-track" style="--road-track-width: ${trackWidth}px;">
      <div class="section-road-map" aria-hidden="true">
        ${bridges}
      </div>
      <div class="section-road-nodes">
        ${cards}
      </div>
    </div>
  </div>`;
}

function renderSectionRoadBridge(index) {
  const roadClass = index % 2 === 0 ? "section-road-svg--one" : "section-road-svg--two";
  const roadSrc = index % 2 === 0 ? "/road/Vector road 1.svg" : "/road/Vector road 2.svg";
  return `<div class="section-road-bridge" style="--bridge-x: ${index * 360 + 110}px;">
    <img class="section-road-svg ${roadClass}" src="${roadSrc}" alt="" />
  </div>`;
}

function renderSectionRoadSegments(points) {
  if (!points.length) return "";
  const segmentPoints = [...points, sectionRoadTailPoint(points)];
  return segmentPoints
    .slice(0, -1)
    .map((point, index) => {
      const next = segmentPoints[index + 1];
      const dx = next.x - point.x;
      const dy = next.y - point.y;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const midX = point.x + dx / 2;
      const midY = point.y + dy / 2;
      return `<img class="section-road-segment" src="/road/Vector road 1.svg" alt="" style="--seg-x: ${midX}%; --seg-y: ${midY}%; --seg-rot: ${angle}deg; --seg-i: ${index};" />`;
    })
    .join("");
}

function sectionRoadTailPoint(points) {
  const last = points[points.length - 1];
  return {
    x: Math.min(104, last.x + 13),
    y: Math.max(16, last.y - 4),
  };
}

function renderSectionRoadPath(points) {
  if (points.length < 2) return "";
  const guidePoints = sectionRoadGuidePoints(points);
  const path = smoothRoadPath(guidePoints);
  return `<svg class="section-road-path" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
    <path class="section-road-path-shadow" d="${path}" />
    <path class="section-road-path-base" d="${path}" />
    <path class="section-road-path-highlight" d="${path}" />
  </svg>`;
}

function sectionRoadGuidePoints(points) {
  const first = points[0];
  const last = points[points.length - 1];
  const lead = { x: Math.max(0, first.x - 15), y: first.y + 2 };
  const tail =
    last.x < 88
      ? [
          { x: 77, y: 45 },
          { x: 88, y: 27 },
          { x: 96, y: 23 },
        ]
      : [{ x: Math.min(99, last.x + 4), y: Math.max(18, last.y - 2) }];
  return [lead, ...points, ...tail];
}

function smoothRoadPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const dx = next.x - current.x;
    path += ` C ${current.x + dx * 0.46} ${current.y}, ${next.x - dx * 0.46} ${next.y}, ${next.x} ${next.y}`;
  }
  return path;
}

function renderSectionRoadCard(section, { selectedId, index }) {
  const active = section.id === selectedId ? " active" : "";
  const banner = sectionBanner(section);
  const hasExercises = (section.exercises || []).length > 0;
  const thumbnail = banner
    ? `<img class="section-road-thumb" src="${escapeHtml(banner)}" alt="" />`
    : `<span class="section-road-thumb section-road-thumb--empty" aria-hidden="true"></span>`;

  return `<article class="section-road-card${active}${hasExercises ? "" : " section-road-card--empty"}" style="--section-x: ${index * 360}px;">
    <div class="section-road-content">
      ${thumbnail}
      <button type="button" class="section-road-button course-pick-select" data-id="${section.id}" ${hasExercises ? "" : "disabled"}>
        Start
      </button>
    </div>
  </article>`;
}

function courseXpValue(course) {
  const count = course?.exerciseCount || 0;
  return count * 10;
}

function courseGridLayout(count) {
  if (count <= 1) return { class: "course-grid--count-1" };
  if (count === 2) return { class: "course-grid--count-2" };
  if (count === 3) return { class: "course-grid--count-3" };
  if (count === 4) return { class: "course-grid--count-4" };
  if (count === 5) return { class: "course-grid--count-5" };
  if (count === 6) return { class: "course-grid--count-6" };
  return { class: "course-grid--count-many" };
}

function updateCourseCountBadge(count) {
  const badge = $("#course-count-badge");
  if (!badge) return;
  if (!count) {
    badge.hidden = true;
    badge.textContent = "";
    return;
  }
  badge.hidden = false;
  badge.textContent = `${count} quest${count === 1 ? "" : "s"} ready to play`;
}

function renderCourseCard(course, { selectedId, index }) {
  const active = course.id === selectedId ? " active" : "";
  const title = courseTitle(course);
  const description = courseDescription(course);
  const level = courseLevelLabel();
  const banner = courseBanner(course);
  const questNum = index + 1;
  const xp = courseXpValue(course);
  const exerciseCount = course.exerciseCount || 0;
  const thumb = banner
    ? `<img class="course-pick-thumb" src="${escapeHtml(banner)}" alt="" />`
    : `<div class="course-pick-thumb course-pick-thumb--empty" aria-hidden="true"></div>`;

  return `<article class="course-pick-card${active}" data-id="${course.id}" style="--card-i: ${index}">
    <span class="course-quest-badge">Quest ${questNum}</span>
    ${xp > 0 ? `<span class="course-xp-badge">${xp} XP</span>` : ""}
    <div class="course-pick-card-inner">
      ${thumb}
      <div class="course-pick-body">
        <h2 class="course-pick-title">${escapeHtml(title)}</h2>
        <p class="course-pick-desc">${escapeHtml(description)}</p>
        ${level ? `<p class="course-pick-level">${escapeHtml(level)}</p>` : ""}
        ${exerciseCount > 0 ? `<p class="course-pick-stars" aria-label="${exerciseCount} exercises">${"★".repeat(Math.min(exerciseCount, 5))}${exerciseCount > 5 ? `<span class="course-pick-stars-more">+${exerciseCount - 5}</span>` : ""}</p>` : ""}
        <button type="button" class="course-pick-select" data-id="${course.id}">
          Select
        </button>
      </div>
    </div>
  </article>`;
}

function renderCourseGrid(container, courses, { selectedId, onSelect }) {
  if (!courses.length) {
    container.className = "course-grid";
    container.innerHTML = "";
    return;
  }

  const layout = courseGridLayout(courses.length);
  container.className = `course-grid ${layout.class}`;
  container.innerHTML = courses
    .map((course, index) => renderCourseCard(course, { selectedId, index }))
    .join("");

  container.querySelectorAll(".course-pick-select").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(Number(btn.dataset.id));
    });
  });
}

function renderClassGrid(container, classes, { selectedId, onSelect }) {
  if (!classes.length) {
    container.innerHTML = "";
    return;
  }

  const sections = groupClassesByLevel(classes);
  container.innerHTML = sections
    .map((section) => {
      const heading = section.label
        ? `<h2 class="class-section-title">${escapeHtml(section.label)}</h2>`
        : "";
      const cards = section.items
        .map((classItem) => renderClassCard(classItem, { selectedId, onSelect }))
        .join("");
      return `<section class="class-section">${heading}<div class="class-grid">${cards}</div></section>`;
    })
    .join("");

  container.querySelectorAll(".class-card").forEach((btn) => {
    btn.addEventListener("click", () => onSelect(Number(btn.dataset.id)));
  });
}

function renderPickList(container, items, { selectedId, onSelect }) {
  if (!items.length) {
    container.innerHTML = '<p class="hint">No items found.</p>';
    return;
  }
  container.innerHTML = items
    .map((item) => {
      const active = item.id === selectedId ? " active" : "";
      const meta = item.meta ? `<span class="pick-meta">${escapeHtml(item.meta)}</span>` : "";
      return `<button type="button" class="pick-item${active}" data-id="${item.id}">
        <span class="pick-title">${escapeHtml(item.title)}</span>${meta}
      </button>`;
    })
    .join("");

  container.querySelectorAll(".pick-item").forEach((btn) => {
    btn.addEventListener("click", () => onSelect(Number(btn.dataset.id)));
  });
}

function flattenSections(sections) {
  const exercises = [];
  for (const section of sections || []) {
    for (const exercise of section.exercises || []) {
      exercises.push(exercise);
    }
  }
  return exercises;
}

function exerciseSubtitle(exercise) {
  const subtitle = String(exercise?.subTitle || "").trim();
  if (subtitle) return subtitle;
  if (isVideoExercise(exercise)) return "Watch the lesson video.";
  if (isBuzzinExercise(exercise)) return "Answer fast to score points.";
  if (isFastMcQuizExercise(exercise)) return "Answer quickly — results at the end.";
  if (isMcQuizExercise(exercise)) {
    const questionCount = (exercise.items || []).length;
    return questionCount >= 5 ? "Answer as many as you can!" : "Choose the correct answer.";
  }
  return "";
}

function exercisePointsValue(exercise) {
  const type = normalizeExerciseType(exercise?.type);
  const itemCount = Math.max(1, (exercise?.items || []).length);
  if (type === "video") return 200;
  if (type === "buzzin") return 300;
  if (type === "mcquiz" || type === "fastmcquiz") return itemCount >= 5 ? 500 : 300;
  return 100 * itemCount;
}

function updateExerciseContextLabel() {
  $("#course-label").textContent = courseTitle(state.course);
  $("#section-label").textContent = sectionTitle(state.selectedSection);
}

function renderExerciseItem(exercise, index, selectedId) {
  const active = exercise.id === selectedId;
  const title = exercise.title || `Exercise ${exercise.id}`;
  const subtitle = exerciseSubtitle(exercise);
  const points = exercisePointsValue(exercise);

  return `<button type="button" class="exercise-item${active ? " active" : ""}" data-id="${exercise.id}" role="option" aria-selected="${active ? "true" : "false"}">
    <span class="exercise-item-main">
      <span class="exercise-item-num">${index + 1}.</span>
      <span class="exercise-item-text">
        <span class="exercise-item-title">${escapeHtml(title)}</span>
        ${subtitle ? `<span class="exercise-item-sub">${escapeHtml(subtitle)}</span>` : ""}
      </span>
    </span>
    <span class="exercise-item-pts">${points} pts</span>
  </button>`;
}

function renderExercises() {
  const container = $("#exercise-list");
  const selectedId = state.selectedExercise?.id;
  const exercises = getSelectedSectionExercises();
  updateExerciseContextLabel();

  if (!exercises.length) {
    container.innerHTML = '<p class="exercise-empty">No exercises in this section.</p>';
    $("#btn-start-session").disabled = true;
    return;
  }

  container.innerHTML = exercises
    .map((exercise, index) => renderExerciseItem(exercise, index, selectedId))
    .join("");

  container.querySelectorAll(".exercise-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      state.selectedExercise = exercises.find((e) => e.id === id) || null;
      renderExercises();
      $("#btn-start-session").disabled = !state.selectedExercise;
    });
  });

  $("#btn-start-session").disabled = !state.selectedExercise;
}

async function handleLogin() {
  const username = $("#login-username").value.trim().toLowerCase();
  const password = $("#login-password").value;
  $("#login-error").textContent = "";

  if (!username || !password) {
    $("#login-error").textContent = "Enter username and password.";
    return;
  }

  const btn = $("#btn-login");
  btn.disabled = true;
  try {
    const data = await api("/api/lango/login", {
      method: "POST",
      body: { username, password },
    });
    const user = data.user;
    if (!user?.token) throw new Error("Login succeeded but no token in response.");

    state.user = user;
    state.token = user.token;
    state.loginUsername = username;
    savePrefs();
    await enterClassStep({ resume: true });
  } catch (err) {
    $("#login-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function enterClassStep({ resume = false } = {}) {
  const teacherName = teacherDisplayName();
  $("#teacher-label").textContent = teacherName;
  $("#teacher-label-wrap").hidden = !teacherName;
  $("#class-error").textContent = "";
  $("#class-status").textContent = "Loading classes…";
  $("#class-sections").innerHTML = "";
  goTo("class", "class");

  try {
    const data = await api("/api/lango/classList");
    const classes = extractClassList(data);
    state.classes = classes;

    if (resume && state.classItem?.id) {
      const savedClass = classes.find((c) => Number(c.id) === Number(state.classItem.id));
      if (savedClass) {
        state.classItem = savedClass;
        savePrefs();
        if (state.course?.id) {
          await enterCourseStep({ resume: true });
          return;
        }
      } else {
        state.classItem = null;
        state.course = null;
        savePrefs();
      }
    }

    if (!classes.length) {
      $("#class-status").textContent = "No classes returned for this teacher.";
      return;
    }

    $("#class-status").textContent =
      resume && state.classItem?.id
        ? "Saved class not found — select a class."
        : "";

    function handleClassSelect(id) {
      const next = classes.find((c) => Number(c.id) === Number(id)) || null;
      if (state.classItem?.id !== next?.id) {
        state.course = null;
        state.selectedSection = null;
      }
      state.classItem = next;
      savePrefs();
      renderClassGrid($("#class-sections"), classes, {
        selectedId: state.classItem?.id,
        onSelect: handleClassSelect,
      });
      if (state.classItem) enterCourseStep();
    }

    renderClassGrid($("#class-sections"), classes, {
      selectedId: state.classItem?.id,
      onSelect: handleClassSelect,
    });
  } catch (err) {
    $("#class-status").textContent = "";
    $("#class-error").textContent = err.message;
  }
}

async function enterCourseStep({ resume = false, keepCourse = false } = {}) {
  if (!resume && !keepCourse) {
    state.course = null;
    state.selectedSection = null;
  }
  if (!keepCourse) {
    state.sections = [];
    state.exercises = [];
    state.selectedExercise = null;
  }

  $("#class-label").textContent = state.classItem?.name || "";
  $("#course-error").textContent = "";
  $("#course-status").textContent = "Loading courses…";
  $("#course-sections").innerHTML = "";
  $("#course-sections").className = "course-grid";
  updateCourseCountBadge(0);
  goTo("course", "course");

  try {
    const data = await api(`/api/cms/courses?classId=${state.classItem.id}`);
    state.courses = (data.courses || []).map((course) => ({
      id: course.id,
      name: course.name,
      title: course.name,
      description: course.description || "",
      banner: course.banner || null,
      langCode: course.langCode || "en",
      exerciseCount: course.exerciseCount || 0,
      classIds: course.classIds || [],
    }));

    if (resume && state.course?.id) {
      const savedCourse = findCourseInList(state.course.id);
      if (savedCourse) {
        state.course = savedCourse;
        savePrefs();
        await enterSectionStep({ resume: true });
        return;
      }
      state.course = null;
      state.selectedSection = null;
      savePrefs();
    }

    renderCourseSections();
  } catch (err) {
    $("#course-status").textContent = "";
    $("#course-error").textContent = err.message;
  }
}

function renderCourseSections() {
  if (!state.courses.length) {
    $("#course-status").textContent =
      "No courses assigned to this class — assign one in the CMS or leave classes unassigned.";
    $("#course-sections").innerHTML = "";
    $("#course-sections").className = "course-grid";
    updateCourseCountBadge(0);
    return;
  }

  $("#course-status").textContent = "";
  updateCourseCountBadge(state.courses.length);

  function handleCourseSelect(id) {
    const next = findCourseInList(id);
    if (state.course?.id !== next?.id) {
      state.selectedSection = null;
    }
    state.course = next;
    savePrefs();
    renderCourseGrid($("#course-sections"), state.courses, {
      selectedId: state.course?.id,
      onSelect: handleCourseSelect,
    });
    if (state.course) enterSectionStep();
  }

  renderCourseGrid($("#course-sections"), state.courses, {
    selectedId: state.course?.id,
    onSelect: handleCourseSelect,
  });
}

async function loadCourseSections() {
  const data = await api(`/api/cms/courses/${state.course.id}`);
  state.sections = data.sections || [];
  state.exercises = flattenSections(state.sections);
  return state.sections;
}

async function enterSectionStep({ resume = false } = {}) {
  if (!resume) {
    state.selectedSection = null;
  }
  state.exercises = [];
  state.selectedExercise = null;

  $("#section-error").textContent = "";
  $("#section-status").textContent = "Loading sections…";
  const sectionGrid = $("#section-grid");
  if (sectionGrid) {
    sectionGrid.innerHTML = "";
    sectionGrid.className = "course-grid";
  }
  updateSectionCountBadge(0);
  updateSectionProgressCard([]);
  $("#exercise-list").innerHTML = "";
  $("#journey-error").textContent = "";
  $("#journey-status").textContent = "";
  $("#btn-start-session").disabled = true;
  setSectionExercisePanelVisible(false);
  goTo("section", "section");

  try {
    await loadCourseSections();

    if (resume && state.selectedSection?.id) {
      const savedSection = findSectionInList(state.selectedSection.id);
      if (savedSection) {
        state.selectedSection = savedSection;
        savePrefs();
        renderSectionPicker();
        await showSectionExercises();
        return;
      }
      state.selectedSection = null;
      savePrefs();
    }

    renderSectionPicker();
  } catch (err) {
    $("#section-status").textContent = "";
    $("#section-error").textContent = err.message;
  }
}

function renderSectionPicker() {
  const sections = [...state.sections].sort((a, b) => (a.order || 0) - (b.order || 0));
  const playableSections = sections.filter((section) => (section.exercises || []).length > 0);
  const grid = $("#section-grid");
  const label = $("#section-course-label");
  if (label) label.textContent = courseTitle(state.course);

  if (!sections.length) {
    $("#section-status").textContent = "No sections in this course.";
    renderSectionPickerGrid(grid, [], { selectedId: null, onSelect: () => {} });
    updateSectionCountBadge(0);
    updateSectionProgressCard([]);
    return;
  }

  $("#section-status").textContent = playableSections.length
    ? ""
    : "Sections are listed below — add exercises in the CMS to make them playable.";
  updateSectionCountBadge(sections.length);
  updateSectionProgressCard(sections);

  function handleSectionSelect(id) {
    const section = findSectionInList(id);
    if (!section || !(section.exercises || []).length) return;

    state.selectedSection = section;
    savePrefs();
    renderSectionPickerGrid(grid, sections, {
      selectedId: state.selectedSection?.id,
      onSelect: handleSectionSelect,
    });
    updateSectionProgressCard(sections, state.selectedSection?.id);
    void showSectionExercises();
  }

  renderSectionPickerGrid(grid, sections, {
    selectedId: state.selectedSection?.id,
    onSelect: handleSectionSelect,
  });
}

async function showSectionExercises() {
  state.selectedExercise = null;
  updateExerciseContextLabel();
  $("#journey-error").textContent = "";
  $("#journey-status").textContent = "Loading exercises…";
  $("#exercise-list").innerHTML = "";
  $("#btn-start-session").disabled = true;
  setSectionExercisePanelVisible(true);
  goTo("section", "section");

  try {
    if (!state.sections.length) {
      await loadCourseSections();
    }

    const savedSection = findSectionInList(state.selectedSection?.id);
    if (savedSection) {
      state.selectedSection = savedSection;
    }

    const exercises = getSelectedSectionExercises();
    if (exercises.length) {
      state.selectedExercise = exercises[0];
    }

    if (exercises.length) {
      const mediaUrls = collectExerciseMediaUrls(exercises);
      if (mediaUrls.length) {
        $("#journey-status").textContent = `Downloading media (0/${mediaUrls.length})…`;
        await preloadExerciseMedia(exercises, {
          onProgress: (done, total) => {
            $("#journey-status").textContent = `Downloading media (${done}/${total})…`;
          },
        });
      }
    }

    $("#journey-status").textContent = exercises.length ? "" : "No exercises in this section.";
    renderExercises();
    $("#btn-start-session").disabled = !state.selectedExercise;
  } catch (err) {
    $("#journey-status").textContent = "";
    $("#journey-error").textContent = err.message;
  }
}

/** @deprecated Use showSectionExercises — kept as alias for callers. */
async function enterJourneyStep() {
  await showSectionExercises();
}

function stopWaitingPoll() {
  hostSessionConnected = false;
  stopWaitingTimer();
}

async function startWaitingPoll() {
  hostSessionConnected = false;
  if (!state.activeRoomId) return;
  try {
    await connectHostSession(state.activeRoomId);
    hostSessionConnected = true;
  } catch (err) {
    $("#waiting-error").textContent = err.message;
  }
}

function stopWaitingTimer() {
  if (waitingTimerInterval) {
    clearInterval(waitingTimerInterval);
    waitingTimerInterval = null;
  }
}

function formatWaitingTimer(seconds) {
  const mins = Math.max(0, Math.floor(seconds / 60));
  const secs = Math.max(0, seconds % 60);
  return `${String(mins).padStart(2, "0")} : ${String(secs).padStart(2, "0")}`;
}

function startWaitingTimer() {
  stopWaitingTimer();
  let remaining = WAITING_TIMER_SECONDS;
  const timerEl = $("#waiting-timer-value");
  if (timerEl) timerEl.textContent = formatWaitingTimer(remaining);

  waitingTimerInterval = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    if (timerEl) timerEl.textContent = formatWaitingTimer(remaining);
    if (remaining <= 0) stopWaitingTimer();
  }, 1000);
}

function normalizePersonName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getWaitingClassRoster() {
  const list = state.classItem?.studentList;
  return Array.isArray(list) ? list : [];
}

function participantMatchesStudent(participant, student) {
  if (!participant || !student) return false;

  if (
    participant.userId != null &&
    student.id != null &&
    String(participant.userId) === String(student.id)
  ) {
    return true;
  }

  const participantName = normalizePersonName(participant.displayName);
  const studentName = normalizePersonName(student.fullName);
  if (participantName && studentName && participantName === studentName) return true;

  const firstLast = normalizePersonName(`${student.firstName || ""} ${student.lastName || ""}`);
  if (participantName && firstLast && participantName === firstLast) return true;

  return false;
}

function countConnectedRosterStudents(participants, roster) {
  if (!roster.length) return participants.length;
  return roster.filter((student) =>
    participants.some((participant) => participantMatchesStudent(participant, student))
  ).length;
}

function normalizeWaitingStudent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = Number(raw.id ?? raw.student_id ?? raw.studentId);
  if (!Number.isFinite(id)) return null;

  const firstName = String(
    raw.firstName ?? raw.first_name ?? raw.firstname ?? raw.givenName ?? raw.given_name ?? ""
  ).trim();
  const lastName = String(
    raw.lastName ?? raw.last_name ?? raw.lastname ?? raw.familyName ?? raw.family_name ?? ""
  ).trim();
  const fullName =
    String(raw.fullName ?? raw.full_name ?? raw.name ?? `${firstName} ${lastName}`.trim()).trim() ||
    `Student ${id}`;

  return { id, firstName, lastName, fullName };
}

function normalizeWaitingStudentList(classItem) {
  const list = classItem?.studentList ?? classItem?.student_list ?? classItem?.students ?? [];
  if (!Array.isArray(list)) return [];
  return list.map(normalizeWaitingStudent).filter(Boolean);
}

function findRawClassMatch(data, classId) {
  const rawPayload = data?._rawClassList ?? data;
  const rawClasses = extractClassList(rawPayload);
  return rawClasses.find((c) => Number(c.id ?? c.class_id ?? c.classId) === Number(classId)) || null;
}

async function refreshWaitingClassRoster() {
  if (!state.classItem?.id) return;

  try {
    const data = await api("/api/lango/classList");
    const classes = extractClassList(data);
    let match = classes.find((c) => Number(c.id) === Number(state.classItem.id)) || null;
    const rawMatch = findRawClassMatch(data, state.classItem.id);

    if (match) {
      const studentList = rawMatch
        ? normalizeWaitingStudentList(rawMatch)
        : normalizeWaitingStudentList(match);

      match = {
        ...match,
        studentList,
        studentCount: studentList.length || match.studentCount,
      };
      state.classItem = match;
      savePrefs();
    }
  } catch {
    /* keep cached class roster */
  }
}

function studentFirstName(student) {
  const first = String(student?.firstName || "").trim();
  if (first) return first;
  const full = String(student?.fullName || "").trim();
  if (!full) return "Student";
  return full.split(/\s+/)[0];
}

function participantFirstName(participant) {
  const name = String(participant?.displayName || "").trim();
  if (!name) return "Student";
  return name.split(/\s+/)[0];
}

function renderWaitingStudentCard(student, connected) {
  return `<li class="waiting-student${connected ? " connected" : " pending"}">
    <div class="waiting-student-avatar">
      <img class="waiting-student-photo" src="/assets/waiting/avatar.png" alt="" width="68" height="68" />
    </div>
    <span class="waiting-student-name">${escapeHtml(studentFirstName(student))}</span>
  </li>`;
}

function renderJoinedStudentCard(participant) {
  return `<li class="waiting-student connected">
    <div class="waiting-student-avatar">
      <img class="waiting-student-photo" src="/assets/waiting/avatar.png" alt="" width="68" height="68" />
    </div>
    <span class="waiting-student-name">${escapeHtml(participantFirstName(participant))}</span>
  </li>`;
}

function updateWaitingStudentCount(connected, totalOverride) {
  const currentEl = $("#waiting-connected-count");
  const totalEl = $("#waiting-total-target");
  const roster = getWaitingClassRoster();
  const total =
    totalOverride ??
    (roster.length > 0
      ? roster.length
      : state.waitingTotalTarget > 0
        ? state.waitingTotalTarget
        : connected);

  if (currentEl) currentEl.textContent = String(connected);
  if (totalEl) totalEl.textContent = String(total);
}

function renderParticipants(participants) {
  const list = $("#waiting-participants");
  const statusEl = $("#waiting-participant-status");
  const roster = getWaitingClassRoster();

  if (!list) return;

  if (roster.length) {
    const connectedCount = countConnectedRosterStudents(participants, roster);
    updateWaitingStudentCount(connectedCount, roster.length);

    list.innerHTML = roster
      .map((student) => {
        const connected = participants.some((participant) =>
          participantMatchesStudent(participant, student)
        );
        return renderWaitingStudentCard(student, connected);
      })
      .join("");
  } else {
    const connected = participants.length;
    const total = Math.max(state.waitingTotalTarget || 0, connected, 1);
    const pendingCount = Math.max(0, total - connected);

    updateWaitingStudentCount(connected);

    const connectedMarkup = participants.map((p) => renderJoinedStudentCard(p)).join("");
    const pendingMarkup = Array.from({ length: pendingCount }, () =>
      `<li class="waiting-student pending" aria-hidden="true">
        <div class="waiting-student-avatar waiting-student-avatar--placeholder">
          <img class="waiting-student-photo waiting-student-photo--placeholder" src="/assets/waiting/avatar.png" alt="" width="68" height="68" />
        </div>
        <span class="waiting-student-name">—</span>
      </li>`
    ).join("");

    list.innerHTML = connectedMarkup + pendingMarkup;
  }

  if (statusEl) {
    const connected = roster.length
      ? countConnectedRosterStudents(participants, roster)
      : participants.length;

    if (!connected) {
      statusEl.textContent = "Waiting for students to join…";
    } else {
      const readyCount = participants.filter((p) => p.isReady).length;
      statusEl.textContent =
        connected === 1
          ? "1 student connected"
          : `${connected} students connected` + (readyCount ? ` · ${readyCount} ready` : "");
    }
  }
}

function pickNotificationStats(apiResponse) {
  const payload = apiResponse?.data && typeof apiResponse.data === "object"
    ? apiResponse.data
    : apiResponse;

  const sentCount = payload?.sentCount ?? payload?.sent_count;
  const totalTarget = payload?.totalTarget ?? payload?.total_target;

  return {
    sentCount: sentCount == null ? null : Number(sentCount),
    totalTarget: totalTarget == null ? null : Number(totalTarget),
  };
}

function renderNotificationStats(apiResponse) {
  const { totalTarget } = pickNotificationStats(apiResponse);
  const roster = getWaitingClassRoster();

  state.waitingTotalTarget =
    roster.length > 0
      ? roster.length
      : totalTarget != null && !Number.isNaN(totalTarget) && totalTarget > 0
        ? totalTarget
        : 0;

  updateWaitingStudentCount(0, roster.length || state.waitingTotalTarget || 0);
}

async function enterWaitingRoom(roomId, apiResponse) {
  state.activeRoomId = roomId;
  state.sessionStarted = false;

  $("#waiting-error").textContent = "";
  $("#waiting-room-id").textContent = roomId;
  await refreshWaitingClassRoster();
  renderNotificationStats(apiResponse);

  const startBtn = $("#btn-start-class");
  startBtn.disabled = false;
  startBtn.textContent = "Start Session";

  renderParticipants([]);
  startWaitingTimer();
  goTo("waiting", "waiting");
  void startWaitingPoll();
}

async function handleStartSession() {
  if (!state.selectedExercise) return;

  $("#journey-error").textContent = "";
  const btn = $("#btn-start-session");
  btn.disabled = true;
  btn.textContent = "Creating session…";

  try {
    const result = await api("/api/session/start", {
      method: "POST",
      body: {
        class: state.classItem,
        course: state.course,
        exercise: state.selectedExercise,
        user: state.user,
      },
    });

    const roomId =
      result.roomId ||
      result.sessionId ||
      result.notification?.data?.session_id ||
      "";

    await enterWaitingRoom(roomId, result.apiResponse);
  } catch (err) {
    $("#journey-error").textContent = err.message;
  } finally {
    btn.disabled = !state.selectedExercise;
    btn.textContent = "Start session & send notification";
  }
}

async function runHostExercise(roomId, exercise) {
  state.quizActive = true;
  refreshNextExerciseUi();
  await startHostExercise(roomId, exercise);
  setActiveStep("quiz");
}

async function handleStartNextExercise() {
  const next = getNextExerciseAfter(state.selectedExercise);
  if (!next || !state.activeRoomId) return;

  $("#waiting-error").textContent = "";
  state.selectedExercise = next;

  const buttons = [
    "#btn-host-quiz-next-exercise",
    "#btn-host-video-next-exercise",
    "#btn-host-buzzin-next-exercise",
  ];
  for (const sel of buttons) {
    const btn = $(sel);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Starting next exercise…";
    }
  }

  try {
    await startNextExerciseViaSocket(state.activeRoomId, next);
    state.sessionStarted = true;
    $("#waiting-participant-status").textContent = "Loading next exercise…";
    await runHostExercise(state.activeRoomId, next);
  } catch (err) {
    $("#waiting-error").textContent = err.message;
    refreshNextExerciseUi();
  } finally {
    for (const sel of buttons) {
      const btn = $(sel);
      if (btn) btn.disabled = false;
    }
  }
}

async function handleStartClass() {
  if (!state.activeRoomId || state.sessionStarted) return;

  $("#waiting-error").textContent = "";
  const btn = $("#btn-start-class");
  btn.disabled = true;
  btn.textContent = "Starting…";

  try {
    await startSessionViaSocket(state.activeRoomId);
    state.sessionStarted = true;
    stopWaitingPoll();
    const exerciseType = normalizeExerciseType(state.selectedExercise?.type);
    $("#waiting-participant-status").textContent =
      exerciseType === "mcquiz" || exerciseType === "fastmcquiz"
        ? "Class started — quiz loading…"
        : "Class started — loading exercise…";
    btn.textContent = "Class started";

    await runHostExercise(state.activeRoomId, state.selectedExercise);
  } catch (err) {
    state.quizActive = false;
    $("#waiting-error").textContent = err.message;
    btn.disabled = false;
    btn.textContent = "Start class";
    if (state.sessionStarted) {
      showScreen("waiting");
      setActiveStep("waiting");
    }
  }
}

function handleLogout() {
  stopWaitingPoll();
  disconnectHostSession();
  state.activeRoomId = null;
  state.sessionStarted = false;
  state.quizActive = false;
  clearAuth();
  state.sections = [];
  state.selectedSection = null;
  state.exercises = [];
  state.selectedExercise = null;
  applyLoginUsernameToForm();
  goTo("login", "login");
}

$("#btn-login").addEventListener("click", handleLogin);
$("#login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});

$("#btn-back-login")?.addEventListener("click", handleLogout);

document.querySelectorAll(
  "#btn-logout-course, #btn-logout-section, #btn-logout-waiting, #btn-logout-quiz, #btn-logout-results, #btn-logout-finished, #btn-logout-video, #btn-logout-buzzin"
).forEach((btn) => btn.addEventListener("click", handleLogout));

$("#btn-back-class").addEventListener("click", () => {
  state.course = null;
  state.selectedSection = null;
  savePrefs();
  enterClassStep();
});

$("#btn-back-course-from-section").addEventListener("click", () => {
  state.selectedSection = null;
  state.exercises = [];
  state.selectedExercise = null;
  setSectionExercisePanelVisible(false);
  savePrefs();
  enterCourseStep({ keepCourse: true });
});

$("#section-exercise-backdrop")?.addEventListener("click", closeSectionExercises);
$("#btn-cancel-exercises")?.addEventListener("click", closeSectionExercises);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const overlay = $("#section-exercise-overlay");
  if (overlay && !overlay.hidden && $("#screen-section")?.classList.contains("active")) {
    closeSectionExercises();
  }
});

function backFromWaiting() {
  stopWaitingPoll();
  disconnectHostSession();
  state.activeRoomId = null;
  state.sessionStarted = false;
  state.quizActive = false;
  goTo("section", "section");
  renderSectionPicker();
  void showSectionExercises();
}

$("#btn-back-journey")?.addEventListener("click", backFromWaiting);

document.querySelectorAll(
  "#btn-back-waiting-quiz, #btn-back-waiting-results, #btn-back-waiting-finished, #btn-back-waiting-video, #btn-back-waiting-buzzin"
).forEach((btn) => btn.addEventListener("click", backToWaitingFromExercise));

$("#btn-start-session").addEventListener("click", handleStartSession);

$("#btn-start-class").addEventListener("click", handleStartClass);

$("#btn-copy-room-id").addEventListener("click", async () => {
  const roomId = $("#waiting-room-id").textContent.trim();
  if (!roomId) return;
  try {
    await navigator.clipboard.writeText(roomId);
    const btn = $("#btn-copy-room-id");
    const prevTitle = btn.title;
    btn.title = "Copied!";
    setTimeout(() => {
      btn.title = prevTitle || "Copy room code";
    }, 1500);
  } catch {
    $("#waiting-error").textContent = "Could not copy room code.";
  }
});

function resetSessionAndGoToJourney() {
  stopWaitingPoll();
  state.activeRoomId = null;
  state.sessionStarted = false;
  state.quizActive = false;
  state.selectedExercise = null;
  goTo("section", "section");
  renderSectionPicker();
  void showSectionExercises();
}

$("#btn-start-another").addEventListener("click", resetSessionAndGoToJourney);
$("#btn-start-another-quiz")?.addEventListener("click", resetSessionAndGoToJourney);

$("#btn-host-quiz-done")?.addEventListener("click", () => {
  refreshNextExerciseUi();
  showScreen("waiting");
  setActiveStep("waiting");
});

function backToWaitingFromExercise() {
  refreshNextExerciseUi();
  showScreen("waiting");
  setActiveStep("waiting");
}

$("#btn-host-video-done")?.addEventListener("click", backToWaitingFromExercise);
$("#btn-host-buzzin-done")?.addEventListener("click", backToWaitingFromExercise);
$("#btn-start-another-video")?.addEventListener("click", resetSessionAndGoToJourney);
$("#btn-start-another-buzzin")?.addEventListener("click", resetSessionAndGoToJourney);

document.querySelectorAll(
  "#btn-host-quiz-next-exercise, #btn-host-video-next-exercise, #btn-host-buzzin-next-exercise"
).forEach((btn) => btn.addEventListener("click", () => void handleStartNextExercise()));

$("#login-username").addEventListener("change", () => {
  state.loginUsername = $("#login-username").value.trim().toLowerCase();
  savePrefs();
});

loadPrefs();
applyLoginUsernameToForm();

if (state.token && state.user) {
  enterClassStep({ resume: true });
} else {
  goTo("login", "login");
}
