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
  hostProgress: null,
  hostProgressSaving: false,
  activeRoomId: null,
  quizActive: false,
  waitingTotalTarget: 0,
};

let hostSessionConnected = false;
let waitingTimerInterval = null;
let classSessionCreating = false;
let exerciseLottieInstances = [];
let waitingClockLottieInstance = null;
let sectionExerciseCloseTimer = null;
const WAITING_TIMER_SECONDS = 300;
const SECTION_EXERCISE_CLOSE_MS = 260;
const LOGIN_SCAN_CYCLE_MS = 3600;
const HOST_SOUND_EFFECTS = {
  loginSuccess: "/assets/soundeffect/login_success.mp3",
  loginFail: "/assets/soundeffect/login_fail.mp3",
  startSession: "/assets/soundeffect/Start.mp3",
  uncleTommyLetsGo: [
    "/assets/soundeffect/uncletommy_letsgo_1.mp3",
    "/assets/soundeffect/uncletommy_letsgo_2.mp3",
  ],
  exerciseCountdownVideo: "/assets/transitions/countdown321.mp4",
  pageNext: "/assets/soundeffect/Page_nextbutton.mp3",
  pageBack: "/assets/soundeffect/Page_Backforward.mp3",
};
const HOST_BGM_TRACKS = [
  "/assets/bgm/BGM_1.mp3",
  "/assets/bgm/BGM_2.mp3",
];
const HOST_BGM_VOLUME = 0.3;
const HOST_BGM_FADE_MS = 700;
const hostSoundBank = new Map();
let hostBgmAudio = null;
let hostBgmLastTrack = "";
let hostBgmStarted = false;
let hostBgmFadeFrame = null;
let hostBgmMuted = false;
let hostSoundEffectsMuted = false;
let hostSoundMenuOpen = false;

function isImageAssignmentExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "imageassignment";
}

function isVoiceAssignmentExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "voiceassignment";
}

function fitHostStage() {
  const app = document.querySelector("#app.lango-host");
  if (!app) return;
  const viewport = window.visualViewport || window;
  const width = viewport.width || window.innerWidth || HOST_STAGE_WIDTH;
  const height = viewport.height || window.innerHeight || HOST_STAGE_HEIGHT;
  const scale = Math.min(width / HOST_STAGE_WIDTH, height / HOST_STAGE_HEIGHT);
  app.style.setProperty("--host-stage-scale", String(scale));
}

function waitForLoginScanCycle(startedAt) {
  if (!startedAt) return Promise.resolve();
  const elapsed = performance.now() - startedAt;
  const remaining = LOGIN_SCAN_CYCLE_MS - (elapsed % LOGIN_SCAN_CYCLE_MS);
  return new Promise((resolve) => setTimeout(resolve, Math.max(180, remaining)));
}

function playHostSound(src, { volume = 1 } = {}) {
  if (!src || hostSoundEffectsMuted) return;
  let audio = hostSoundBank.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    hostSoundBank.set(src, audio);
  }
  audio.pause();
  audio.currentTime = 0;
  audio.volume = volume;
  const playPromise = audio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      /* Browsers can block audio until a user gesture; ignore gracefully. */
    });
  }
}

function playHostSoundAwait(src, { volume = 1 } = {}) {
  return new Promise((resolve) => {
    if (!src || hostSoundEffectsMuted) {
      resolve();
      return;
    }
    const audio = new Audio(src);
    audio.volume = volume;
    const finish = () => resolve();
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    const playPromise = audio.play();
    if (playPromise?.catch) playPromise.catch(finish);
  });
}

function playHostSoundGroup(sources, options) {
  for (const src of sources.filter(Boolean)) {
    playHostSound(src, options);
  }
}

function pickHostBgmTrack() {
  const tracks = HOST_BGM_TRACKS.filter(Boolean);
  if (!tracks.length) return "";
  if (tracks.length === 1) return tracks[0];
  let next = tracks[Math.floor(Math.random() * tracks.length)];
  if (next === hostBgmLastTrack) {
    next = tracks[(tracks.indexOf(next) + 1) % tracks.length];
  }
  hostBgmLastTrack = next;
  return next;
}

function playNextHostBgm() {
  if (!hostBgmAudio) return;
  const track = pickHostBgmTrack();
  if (!track) return;
  hostBgmAudio.src = track;
  hostBgmAudio.currentTime = 0;
  const playPromise = hostBgmAudio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      hostBgmStarted = false;
    });
  }
}

function startHostBgm() {
  if (hostBgmMuted || hostBgmStarted) return;
  if (!hostBgmAudio) {
    hostBgmAudio = new Audio();
    hostBgmAudio.volume = HOST_BGM_VOLUME;
    hostBgmAudio.addEventListener("ended", playNextHostBgm);
  }
  hostBgmStarted = true;
  playNextHostBgm();
}

function fadeHostBgmTo(targetVolume, { pauseAtEnd = false } = {}) {
  if (!hostBgmAudio) {
    if (targetVolume <= 0) return;
    startHostBgm();
  }
  if (!hostBgmAudio) return;

  if (hostBgmFadeFrame != null) {
    cancelAnimationFrame(hostBgmFadeFrame);
    hostBgmFadeFrame = null;
  }

  const audio = hostBgmAudio;
  const target = Math.max(0, Math.min(1, targetVolume));
  const startVolume = audio.volume;
  const startedAt = performance.now();

  if (target > 0 && audio.paused) {
    hostBgmStarted = true;
    const playPromise = audio.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        hostBgmStarted = false;
      });
    }
  }

  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / HOST_BGM_FADE_MS);
    audio.volume = startVolume + (target - startVolume) * progress;

    if (progress < 1) {
      hostBgmFadeFrame = requestAnimationFrame(step);
      return;
    }

    hostBgmFadeFrame = null;
    audio.volume = target;
    if (pauseAtEnd && target === 0) audio.pause();
  };

  hostBgmFadeFrame = requestAnimationFrame(step);
}

function fadeOutHostBgm() {
  fadeHostBgmTo(0, { pauseAtEnd: true });
}

function fadeInHostBgm() {
  if (hostBgmMuted) return;
  if (!hostBgmAudio) startHostBgm();
  if (!hostBgmAudio) return;

  if (hostBgmAudio.paused) hostBgmAudio.volume = 0;
  fadeHostBgmTo(HOST_BGM_VOLUME);
}

function setupHostBgm({ autostart = true } = {}) {
  const startFromGesture = () => {
    startHostBgm();
  };
  document.addEventListener("pointerdown", startFromGesture);
  document.addEventListener("keydown", startFromGesture);
  if (autostart && !hostBgmMuted) startHostBgm();
}

function setHostBgmMuted(muted) {
  hostBgmMuted = Boolean(muted);
  if (hostBgmMuted) {
    fadeOutHostBgm();
  } else {
    fadeInHostBgm();
  }
}

function setHostSoundEffectsMuted(muted) {
  hostSoundEffectsMuted = Boolean(muted);
}

function updateHostSoundControls() {
  const btn = $("#btn-host-mute");
  const bgmState = $("#host-bgm-state");
  const effectsState = $("#host-effects-state");
  const bgmBtn = $("#btn-host-toggle-bgm");
  const effectsBtn = $("#btn-host-toggle-effects");

  if (btn) {
    const bothMuted = hostBgmMuted && hostSoundEffectsMuted;
    const anyMuted = hostBgmMuted || hostSoundEffectsMuted;
    btn.classList.toggle("is-muted", bothMuted);
    btn.classList.toggle("is-partial-muted", anyMuted && !bothMuted);
    btn.setAttribute("aria-expanded", hostSoundMenuOpen ? "true" : "false");
    const label = bothMuted ? "Sound settings (all muted)" : "Sound settings";
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  if (bgmState) {
    bgmState.textContent = hostBgmMuted ? "Muted" : "On";
  }
  if (effectsState) {
    effectsState.textContent = hostSoundEffectsMuted ? "Muted" : "On";
  }
  if (bgmBtn) {
    bgmBtn.classList.toggle("is-muted", hostBgmMuted);
    bgmBtn.setAttribute("aria-pressed", hostBgmMuted ? "true" : "false");
  }
  if (effectsBtn) {
    effectsBtn.classList.toggle("is-muted", hostSoundEffectsMuted);
    effectsBtn.setAttribute("aria-pressed", hostSoundEffectsMuted ? "true" : "false");
  }

  const wrap = $("#host-sound-controls");
  const menu = $("#host-sound-menu");

  if (wrap) wrap.classList.toggle("is-menu-open", hostSoundMenuOpen);
  if (menu) menu.setAttribute("aria-hidden", hostSoundMenuOpen ? "false" : "true");
}

function openHostSoundMenu() {
  hostSoundMenuOpen = true;
  updateHostSoundControls();
}

function closeHostSoundMenu() {
  hostSoundMenuOpen = false;
  updateHostSoundControls();
}

function toggleHostSoundMenu() {
  if (hostSoundMenuOpen) closeHostSoundMenu();
  else openHostSoundMenu();
}

function setHostBgmMutedPersisted(muted) {
  setHostBgmMuted(muted);
  updateHostSoundControls();
  savePrefs();
}

function setHostSoundEffectsMutedPersisted(muted) {
  setHostSoundEffectsMuted(muted);
  updateHostSoundControls();
  savePrefs();
}

function updateHostMuteButton() {
  updateHostSoundControls();
}

function setHostSoundMuted(muted) {
  const shouldMute = Boolean(muted);
  setHostBgmMuted(shouldMute);
  setHostSoundEffectsMuted(shouldMute);
  updateHostSoundControls();
  savePrefs();
}

function setupHostMuteButton() {
  const btn = $("#btn-host-mute");
  const bgmBtn = $("#btn-host-toggle-bgm");
  const effectsBtn = $("#btn-host-toggle-effects");
  const wrap = $("#host-sound-controls");

  if (btn) {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleHostSoundMenu();
    });
  }

  if (bgmBtn) {
    bgmBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setHostBgmMutedPersisted(!hostBgmMuted);
    });
  }

  if (effectsBtn) {
    effectsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setHostSoundEffectsMutedPersisted(!hostSoundEffectsMuted);
    });
  }

  document.addEventListener("click", (event) => {
    if (!hostSoundMenuOpen) return;
    if (wrap?.contains(event.target)) return;
    closeHostSoundMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && hostSoundMenuOpen) closeHostSoundMenu();
  });
}

function playLoginSuccessSound() {
  playHostSound(HOST_SOUND_EFFECTS.loginSuccess);
}

function playLoginFailSound() {
  playHostSound(HOST_SOUND_EFFECTS.loginFail);
}

function playPageNextSound() {
  playHostSound(HOST_SOUND_EFFECTS.pageNext, { volume: 0.85 });
}

function playPageBackSound() {
  playHostSound(HOST_SOUND_EFFECTS.pageBack, { volume: 0.85 });
}

async function playStartSessionSound() {
  const letsGoOptions = HOST_SOUND_EFFECTS.uncleTommyLetsGo;
  const letsGo = letsGoOptions[Math.floor(Math.random() * letsGoOptions.length)];
  playHostSound(HOST_SOUND_EFFECTS.startSession);
  await playHostSoundAwait(letsGo);
}

function getExerciseCountdownLayer() {
  const app = document.querySelector("#app.lango-host");
  if (!app) return null;

  let layer = app.querySelector(".host-exercise-countdown");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "host-exercise-countdown";
    layer.setAttribute("aria-hidden", "true");

    const video = document.createElement("video");
    video.className = "host-exercise-countdown-video";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.src = HOST_SOUND_EFFECTS.exerciseCountdownVideo;
    layer.appendChild(video);
    app.appendChild(layer);
  }

  return layer;
}

function playExerciseCountdownVideo() {
  return new Promise((resolve) => {
    const layer = getExerciseCountdownLayer();
    const video = layer?.querySelector("video");
    if (!layer || !video) {
      resolve();
      return;
    }

    const finish = () => {
      layer.classList.remove("is-playing");
      video.pause();
      resolve();
    };

    video.currentTime = 0;
    video.muted = hostSoundEffectsMuted;
    layer.classList.add("is-playing");
    video.addEventListener("ended", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
    const playPromise = video.play();
    if (playPromise?.catch) playPromise.catch(finish);
  });
}

function shouldPlayHostMcQuizCountdown(exercise) {
  const type = normalizeExerciseType(exercise?.type);
  return type === "mcquiz" || type === "fastmcquiz";
}

function flashStartSessionArt() {
  const art = $("#waiting-start-session-art");
  if (!art) return;
  art.classList.remove("is-playing");
  void art.offsetWidth;
  art.classList.add("is-playing");
  window.setTimeout(() => art.classList.remove("is-playing"), 2600);
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
    if (typeof data.soundMuted === "boolean") {
      hostBgmMuted = data.soundMuted;
      hostSoundEffectsMuted = data.soundMuted;
    }
    if (typeof data.bgmMuted === "boolean") hostBgmMuted = data.bgmMuted;
    if (typeof data.soundEffectsMuted === "boolean") hostSoundEffectsMuted = data.soundEffectsMuted;
    if (data.token && data.user) {
      state.token = data.token;
      state.user = data.user;
    }
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
      bgmMuted: hostBgmMuted,
      soundEffectsMuted: hostSoundEffectsMuted,
      soundMuted: hostBgmMuted && hostSoundEffectsMuted,
    })
  );
}

function applyLoginUsernameToForm() {
  applyTeacherLoginDefaults($("#login-username"), $("#login-password"), state.loginUsername);
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

function emptyHostProgress() {
  return {
    completedExerciseIds: [],
    visitedSectionIds: [],
    lastSectionId: null,
    lastExerciseId: null,
  };
}

function completedExerciseIdSet() {
  return new Set(state.hostProgress?.completedExerciseIds || []);
}

function isHostExerciseCompleted(exerciseId) {
  return completedExerciseIdSet().has(Number(exerciseId));
}

function getSortedSections() {
  return [...state.sections].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function getPlayableSections(sections = getSortedSections()) {
  return sections.filter((section) => (section.exercises || []).length > 0);
}

function sectionExerciseList(section) {
  return [...(section.exercises || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function isHostSectionUnlocked(section, playableSections) {
  const index = playableSections.findIndex((entry) => entry.id === section.id);
  if (index <= 0) return index === 0;
  const previous = playableSections[index - 1];
  const previousExercises = sectionExerciseList(previous);
  if (!previousExercises.length) return isHostSectionUnlocked(previous, playableSections);
  return previousExercises.every((exercise) => isHostExerciseCompleted(exercise.id));
}

function isHostExerciseUnlocked(exercise, exerciseIndex, exercises) {
  if (exerciseIndex <= 0) return true;
  return isHostExerciseCompleted(exercises[exerciseIndex - 1]?.id);
}

function countCompletedHostSections(sections = getSortedSections()) {
  const playable = getPlayableSections(sections);
  return playable.filter((section) => {
    const exercises = sectionExerciseList(section);
    return exercises.length > 0 && exercises.every((exercise) => isHostExerciseCompleted(exercise.id));
  }).length;
}

function defaultUnlockedHostExercise(exercises) {
  return exercises.find((exercise, index) => isHostExerciseUnlocked(exercise, index, exercises)) || null;
}

function preferredHostExercise(exercises) {
  const lastExerciseId = state.hostProgress?.lastExerciseId;
  if (lastExerciseId != null) {
    const saved = exercises.find((exercise) => exercise.id === lastExerciseId);
    const savedIndex = saved ? exercises.findIndex((exercise) => exercise.id === saved.id) : -1;
    if (saved && savedIndex >= 0 && isHostExerciseUnlocked(saved, savedIndex, exercises)) {
      return saved;
    }
  }
  const nextIncomplete = exercises.find(
    (exercise, index) =>
      isHostExerciseUnlocked(exercise, index, exercises) && !isHostExerciseCompleted(exercise.id)
  );
  return nextIncomplete || defaultUnlockedHostExercise(exercises);
}

async function loadHostProgress() {
  if (!state.course?.id || !state.classItem?.id) {
    state.hostProgress = emptyHostProgress();
    return;
  }

  try {
    const data = await api(
      `/api/host/progress?classId=${state.classItem.id}&courseId=${state.course.id}`
    );
    state.hostProgress = data.progress || emptyHostProgress();
  } catch {
    state.hostProgress = emptyHostProgress();
  }
}

async function persistHostProgress(patch) {
  if (!state.course?.id || !state.classItem?.id) return;
  if (state.hostProgressSaving) return;

  state.hostProgressSaving = true;
  try {
    const data = await api("/api/host/progress", {
      method: "PUT",
      body: {
        classId: state.classItem.id,
        courseId: state.course.id,
        ...patch,
      },
    });
    state.hostProgress = data.progress || state.hostProgress || emptyHostProgress();
    savePrefs();
  } catch (err) {
    console.warn("Could not save host progress:", err.message);
  } finally {
    state.hostProgressSaving = false;
  }
}

async function markHostSectionVisited(sectionId) {
  if (sectionId == null) return;
  await persistHostProgress({
    visitedSectionIds: [Number(sectionId)],
    lastSectionId: Number(sectionId),
  });
}

async function markHostExerciseSelected(exerciseId) {
  if (exerciseId == null) return;
  await persistHostProgress({ lastExerciseId: Number(exerciseId) });
}

async function markHostExerciseCompleted(exerciseId) {
  if (exerciseId == null || isHostExerciseCompleted(exerciseId)) return;
  await persistHostProgress({ completedExerciseIds: [Number(exerciseId)] });
  updateSectionProgressCard(getSortedSections(), state.selectedSection?.id);
  renderSectionPicker();
  renderExercises();
}

function markCurrentHostExerciseCompleted() {
  if (!state.selectedExercise?.id) return;
  void markHostExerciseCompleted(state.selectedExercise.id);
}

window.markCurrentHostExerciseCompleted = markCurrentHostExerciseCompleted;

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
    "btn-host-fast-results-next-exercise",
    "btn-host-video-next-exercise",
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

function getVisibleRoomCode() {
  return normalizePin(state.activeRoomId || $("#waiting-room-id")?.textContent || "");
}

function updatePersistentRoomCode(screenId) {
  const card = $("#host-persistent-room-code");
  const value = $("#persistent-room-id");
  if (!card || !value) return;

  const roomScreenIds = [
    "section",
    "host-quiz-preview",
    "host-quiz-question",
    "host-quiz-results",
    "host-fast-results",
    "host-quiz-finished",
    "host-video",
    "host-buzzin",
    "host-buzzin-feedback",
  ];
  const roomCode = getVisibleRoomCode();
  const shouldShow = Boolean(roomCode && roomScreenIds.includes(screenId));
  card.classList.toggle("is-visible", shouldShow);
  card.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  if (shouldShow) {
    value.textContent = formatRoomCode(roomCode);
  }
}

function getActiveHostScreenId() {
  const active = document.querySelector("#app.lango-host .screen.active");
  return active?.id?.replace(/^screen-/, "") || "";
}

function syncPersistentRoomCode() {
  updatePersistentRoomCode(getActiveHostScreenId());
}

function initPersistentRoomCodeSync() {
  syncPersistentRoomCode();

  const waitingRoomId = $("#waiting-room-id");
  if (waitingRoomId) {
    new MutationObserver(syncPersistentRoomCode).observe(waitingRoomId, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  document.querySelectorAll("#app.lango-host .screen").forEach((screen) => {
    new MutationObserver(syncPersistentRoomCode).observe(screen, {
      attributes: true,
      attributeFilter: ["class"],
    });
  });
}

window.addEventListener("lango:screen-change", (event) => {
  updatePersistentRoomCode(event.detail?.screenId);
});

function goTo(screenId, stepId) {
  showScreen(screenId);
  setActiveStep(stepId);
  updatePersistentRoomCode(screenId);
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

  const completed = countCompletedHostSections(sortedSections);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const progressDeg = percent * 3.6;

  $("#section-current-progress-completed").textContent = String(completed);
  $("#section-current-progress-total").textContent = String(total);
  $("#section-current-progress-pct").textContent = `${percent}%`;
  $("#section-current-progress-ring").style.setProperty("--section-current-progress", `${progressDeg}deg`);
  const progressKey = `${completed}/${total}`;
  if (card.dataset.progressKey && card.dataset.progressKey !== progressKey) {
    card.classList.remove("section-current-progress--updated");
    requestAnimationFrame(() => {
      card.classList.add("section-current-progress--updated");
    });
  }
  card.dataset.progressKey = progressKey;
  card.hidden = false;
}

function setSectionExercisePanelVisible(visible) {
  const overlay = $("#section-exercise-overlay");
  const scene = document.querySelector("#screen-section .section-scene");
  if (!overlay) {
    if (scene) scene.classList.toggle("section-scene--exercises-open", visible);
    return;
  }

  if (sectionExerciseCloseTimer) {
    clearTimeout(sectionExerciseCloseTimer);
    sectionExerciseCloseTimer = null;
  }

  if (visible) {
    overlay.hidden = false;
    overlay.classList.remove("is-closing");
    if (scene) scene.classList.add("section-scene--exercises-open");
    return;
  }

  if (overlay.hidden) {
    overlay.classList.remove("is-closing");
    if (scene) scene.classList.remove("section-scene--exercises-open");
    return;
  }

  overlay.classList.add("is-closing");
  if (scene) scene.classList.remove("section-scene--exercises-open");
  sectionExerciseCloseTimer = setTimeout(() => {
    overlay.hidden = true;
    overlay.classList.remove("is-closing");
    sectionExerciseCloseTimer = null;
  }, SECTION_EXERCISE_CLOSE_MS);
}

function closeSectionExercises() {
  setSectionExercisePanelVisible(false);
}

function renderSectionPickCard(section, { selectedId, index, locked = false }) {
  const active = section.id === selectedId ? " active" : "";
  const banner = sectionBanner(section);
  const exerciseCount = (section.exercises || []).length;
  const hasExercises = exerciseCount > 0;
  const thumb = banner
    ? `<img class="course-pick-thumb" src="${escapeHtml(banner)}" alt="" />`
    : `<div class="course-pick-thumb course-pick-thumb--empty" aria-hidden="true"></div>`;
  const playButton = !hasExercises
    ? `<button type="button" class="course-pick-select course-pick-select--disabled" data-id="${section.id}" disabled>
          Start
        </button>`
    : locked
      ? `<button type="button" class="course-pick-select course-pick-select--locked" data-id="${section.id}" disabled>
          Locked
        </button>`
      : `<button type="button" class="course-pick-select" data-id="${section.id}">
          Start
        </button>`;

  return `<article class="course-pick-card${active}${hasExercises ? "" : " course-pick-card--empty"}${locked ? " course-pick-card--locked" : ""}" data-id="${section.id}" style="--card-i: ${index}">
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

  const playableSections = getPlayableSections(sections);
  container.className = "section-road";
  container.innerHTML = renderSectionRoad(sections, { selectedId, playableSections });

  container.querySelectorAll(".section-road-select-target:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.activating === "true") return;
      btn.dataset.activating = "true";
      btn.classList.remove("is-pressed");
      void btn.offsetWidth;
      btn.classList.add("is-pressed");
      playPageNextSound();
      window.setTimeout(() => onSelect(Number(btn.dataset.id)), 160);
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

function renderSectionRoad(sections, { selectedId, playableSections = getPlayableSections(sections) }) {
  const trackWidth = Math.max(220, (sections.length - 1) * 360 + 220);
  const bridgeCount = Math.max(0, sections.length - 1);
  const bridges = Array.from({ length: bridgeCount }, (_, index) => renderSectionRoadBridge(index))
    .join("");
  const cards = sections
    .map((section, index) =>
      renderSectionRoadCard(section, {
        selectedId,
        index,
        locked: !isHostSectionUnlocked(section, playableSections),
      })
    )
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

function renderSectionRoadCard(section, { selectedId, index, locked = false }) {
  const active = section.id === selectedId ? " active" : "";
  const banner = sectionBanner(section);
  const hasExercises = (section.exercises || []).length > 0;
  const buttonLabel = !hasExercises || locked ? "Locked" : "Start";
  const disabled = !hasExercises || locked ? "disabled" : "";
  const thumbnailContent = banner
    ? `<img class="section-road-thumb" src="${escapeHtml(banner)}" alt="" />`
    : `<span class="section-road-thumb section-road-thumb--empty" aria-hidden="true"></span>`;
  const lockIcon = disabled
    ? `<span class="section-road-lock" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M7 10V8a5 5 0 0 1 10 0v2h1.25A1.75 1.75 0 0 1 20 11.75v8.5A1.75 1.75 0 0 1 18.25 22H5.75A1.75 1.75 0 0 1 4 20.25v-8.5A1.75 1.75 0 0 1 5.75 10H7Zm2.5 0h5V8a2.5 2.5 0 0 0-5 0v2Zm2.5 3.5a2 2 0 0 0-1 3.73V19h2v-1.77a2 2 0 0 0-1-3.73Z" />
        </svg>
      </span>`
    : "";
  const thumbnail = `<button type="button" class="section-road-thumb-button section-road-select-target" data-id="${section.id}" aria-label="${buttonLabel} section" ${disabled}>
    ${thumbnailContent}
    ${lockIcon}
  </button>`;

  return `<article class="section-road-card${active}${hasExercises ? "" : " section-road-card--empty"}${locked ? " section-road-card--locked" : ""}" style="--section-x: ${index * 360}px;">
    <div class="section-road-content">
      ${thumbnail}
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
      playPageNextSound();
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
    btn.addEventListener("click", () => {
      playPageNextSound();
      onSelect(Number(btn.dataset.id));
    });
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
  if (isBuzzinExercise(exercise)) return "First to buzz in answers.";
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

function destroyExerciseLotties() {
  exerciseLottieInstances.forEach((anim) => {
    try {
      anim.destroy();
    } catch (_) {}
  });
  exerciseLottieInstances = [];
}

function initExerciseLotties() {
  destroyExerciseLotties();
  if (typeof lottie === "undefined") return;

  document
    .querySelectorAll("#exercise-list .exercise-item-lottie[data-lottie-path]")
    .forEach((el) => {
      const anim = lottie.loadAnimation({
        container: el,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: el.dataset.lottiePath,
      });
      exerciseLottieInstances.push(anim);
    });
}

function initWaitingClockLottie() {
  const el = $("#waiting-timer-watch-lottie");
  if (!el || waitingClockLottieInstance || typeof lottie === "undefined") return;
  waitingClockLottieInstance = lottie.loadAnimation({
    container: el,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: el.dataset.lottiePath || "/assets/lottie/clock.json",
  });
}

function renderExerciseItem(exercise, index, selectedId, { locked = false, completed = false } = {}) {
  const active = exercise.id === selectedId;
  const title = exercise.title || `Exercise ${exercise.id}`;
  const subtitle = exerciseSubtitle(exercise);
  const points = exercisePointsValue(exercise);
  const statusLabel = locked ? "Locked" : `${points} pts`;
  const mcClass = isMcQuizExercise(exercise) ? " exercise-item--mc" : "";
  const videoClass = isVideoExercise(exercise) ? " exercise-item--video" : "";
  const buzzinClass = isBuzzinExercise(exercise) ? " exercise-item--buzzin" : "";
  const fastMcClass = isFastMcQuizExercise(exercise) ? " exercise-item--fastmc" : "";
  const imageAssignmentClass = isImageAssignmentExercise(exercise) ? " exercise-item--image-assignment" : "";
  const voiceAssignmentClass = isVoiceAssignmentExercise(exercise) ? " exercise-item--voice-assignment" : "";
  const lottiePath = isVideoExercise(exercise)
    ? "/assets/lottie/video-player.json"
    : isBuzzinExercise(exercise)
      ? "/assets/lottie/buzz_in_logo.json"
      : isFastMcQuizExercise(exercise)
        ? "/assets/lottie/FastMC_logo.json"
        : isMcQuizExercise(exercise)
          ? "/assets/lottie/MC_logo.json"
          : isImageAssignmentExercise(exercise)
            ? "/assets/lottie/image_assignment_logo.json"
            : isVoiceAssignmentExercise(exercise)
              ? "/assets/lottie/voice_assignment_logo.json"
      : "";
  const lottieHtml = lottiePath
    ? `<span class="exercise-item-lottie" data-lottie-path="${escapeHtml(lottiePath)}" aria-hidden="true"></span>`
    : "";

  return `<button type="button" class="exercise-item${mcClass}${videoClass}${buzzinClass}${fastMcClass}${imageAssignmentClass}${voiceAssignmentClass}${active ? " active" : ""}${locked ? " exercise-item--locked" : ""}${completed ? " exercise-item--completed" : ""}" data-id="${exercise.id}" data-locked="${locked ? "true" : "false"}" role="option" aria-selected="${active ? "true" : "false"}" ${locked ? "disabled" : ""}>
    <span class="exercise-item-main">
      <span class="exercise-item-num">${index + 1}.</span>
      ${lottieHtml}
      <span class="exercise-item-text">
        <span class="exercise-item-title">${escapeHtml(title)}</span>
        ${subtitle ? `<span class="exercise-item-sub">${escapeHtml(subtitle)}</span>` : ""}
      </span>
    </span>
    <span class="exercise-item-pts">${statusLabel}</span>
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
    .map((exercise, index) =>
      renderExerciseItem(exercise, index, selectedId, {
        locked: !isHostExerciseUnlocked(exercise, index, exercises),
        completed: isHostExerciseCompleted(exercise.id),
      })
    )
    .join("");

  container.querySelectorAll(".exercise-item:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      const exerciseIndex = exercises.findIndex((exercise) => exercise.id === id);
      const exercise = exercises[exerciseIndex];
      if (!exercise || !isHostExerciseUnlocked(exercise, exerciseIndex, exercises)) return;
      state.selectedExercise = exercise;
      void markHostExerciseSelected(exercise.id);
      renderExercises();
      $("#btn-start-session").disabled = !state.selectedExercise;
    });
  });

  $("#btn-start-session").disabled =
    !state.selectedExercise ||
    !exercises.some(
      (exercise, index) =>
        exercise.id === state.selectedExercise?.id && isHostExerciseUnlocked(exercise, index, exercises)
    );

  initExerciseLotties();
}

async function handleLogin() {
  const btn = $("#btn-login");
  if (btn.disabled) return;
  const btnText = btn.querySelector(".login-btn-text");

  const username = $("#login-username").value.trim().toLowerCase();
  const password = $("#login-password").value;
  $("#login-error").textContent = "";
  btn.classList.remove("is-success", "is-fail");
  if (btnText) btnText.textContent = "Login";
  btn.setAttribute("aria-label", "Login");

  if (!username || !password) {
    $("#login-error").textContent = "Enter username and password.";
    return;
  }

  btn.disabled = true;
  btn.classList.add("is-scanning");
  const scanStartedAt = performance.now();
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
    await waitForLoginScanCycle(scanStartedAt);
    btn.classList.remove("is-scanning");
    btn.classList.add("is-success");
    if (btnText) btnText.textContent = "Success";
    btn.setAttribute("aria-label", "Login success");
    playLoginSuccessSound();
    await enterClassStep();
  } catch (err) {
    await waitForLoginScanCycle(scanStartedAt);
    btn.classList.remove("is-scanning", "is-success");
    btn.classList.add("is-fail");
    if (btnText) btnText.textContent = "Login fail";
    btn.setAttribute("aria-label", "Login failed");
    playLoginFailSound();
    $("#login-error").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-scanning");
  }
}

async function enterClassStep() {
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

    if (!classes.length) {
      $("#class-status").textContent = "No classes returned for this teacher.";
      return;
    }

    $("#class-status").textContent = "";

    function handleClassSelect(id) {
      const next = classes.find((c) => Number(c.id) === Number(id)) || null;
      if (state.classItem?.id !== next?.id) {
        state.course = null;
        state.selectedSection = null;
        state.hostProgress = null;
      }
      state.classItem = next;
      renderClassGrid($("#class-sections"), classes, {
        selectedId: state.classItem?.id,
        onSelect: handleClassSelect,
      });
      if (state.classItem) void createWaitingRoomForClass();
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
      state.hostProgress = null;
    }
    state.course = next;
    state.selectedExercise = null;
    savePrefs();
    renderCourseGrid($("#course-sections"), state.courses, {
      selectedId: state.course?.id,
      onSelect: handleCourseSelect,
    });
    if (state.course) void enterSectionStep();
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
  destroyExerciseLotties();
  $("#exercise-list").innerHTML = "";
  $("#journey-error").textContent = "";
  $("#journey-status").textContent = "";
  $("#btn-start-session").disabled = true;
  setSectionExercisePanelVisible(false);
  goTo("section", "section");

  try {
    await loadCourseSections();
    await loadHostProgress();

    if (resume && state.selectedSection?.id) {
      const savedSection = findSectionInList(state.selectedSection.id);
      const playableSections = getPlayableSections();
      if (savedSection && isHostSectionUnlocked(savedSection, playableSections)) {
        state.selectedSection = savedSection;
        savePrefs();
        renderSectionPicker();
        await showSectionExercises();
        return;
      }
      state.selectedSection = null;
      savePrefs();
    }

    if (state.hostProgress?.lastSectionId) {
      const savedSection = findSectionInList(state.hostProgress.lastSectionId);
      const playableSections = getPlayableSections();
      if (savedSection && isHostSectionUnlocked(savedSection, playableSections)) {
        state.selectedSection = savedSection;
        savePrefs();
      }
    }

    renderSectionPicker();
  } catch (err) {
    $("#section-status").textContent = "";
    $("#section-error").textContent = err.message;
  }
}

function renderSectionPicker() {
  const sections = getSortedSections();
  const playableSections = getPlayableSections(sections);
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
    if (!isHostSectionUnlocked(section, playableSections)) return;

    state.selectedSection = section;
    savePrefs();
    void markHostSectionVisited(section.id);
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
  destroyExerciseLotties();
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
      state.selectedExercise = preferredHostExercise(exercises);
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

function updateWaitingGridLayout(slotCount) {
  const panel = document.querySelector(".waiting-students-panel");
  if (!panel) return;

  const count = Math.max(1, Number(slotCount) || 1);
  const columns = 6;
  const rows = Math.ceil(count / columns);
  const maxAvatar = 112;
  const minAvatar = 52;
  const gapMax = 30;
  const gapMin = 10;
  const nameLine = 26;
  const gridMaxHeight = 380;

  let avatar = Math.floor((gridMaxHeight - (rows - 1) * gapMax - rows * nameLine) / rows);
  avatar = Math.max(minAvatar, Math.min(maxAvatar, avatar));

  const gap = Math.max(gapMin, Math.min(gapMax, Math.round(avatar * 0.27)));
  const nameSize = Math.max(14, Math.min(22, Math.round(avatar * 0.2)));
  const photoPadding = Math.max(6, Math.round(avatar * 0.11));

  panel.style.setProperty("--waiting-grid-cols", String(columns));
  panel.style.setProperty("--waiting-avatar-size", `${avatar}px`);
  panel.style.setProperty("--waiting-avatar-padding", `${photoPadding}px`);
  panel.style.setProperty("--waiting-grid-gap", `${gap}px`);
  panel.style.setProperty("--waiting-name-size", `${nameSize}px`);
}

function renderParticipants(participants) {
  const list = $("#waiting-participants");
  const statusEl = $("#waiting-participant-status");
  const roster = getWaitingClassRoster();

  if (!list) return;

  let displaySlots = 0;

  if (roster.length) {
    const connectedCount = countConnectedRosterStudents(participants, roster);
    displaySlots = roster.length;
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
    displaySlots = total;

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

  updateWaitingGridLayout(displaySlots);

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
  updateWaitingGridLayout(roster.length || state.waitingTotalTarget || 1);
}

function updateWaitingStartButton() {
  const startBtn = $("#btn-start-class");
  if (!startBtn) return;
  startBtn.disabled = false;
  const label = startBtn.querySelector("span");
  if (label) label.textContent = "Start";
}

async function setupClassSession(roomId, apiResponse) {
  state.activeRoomId = roomId;
  state.quizActive = false;

  $("#waiting-error").textContent = "";
  $("#waiting-room-id").textContent = formatRoomCode(roomId);
  await refreshWaitingClassRoster();
  renderNotificationStats(apiResponse);
  updateWaitingStartButton();

  renderParticipants([]);
  void startWaitingPoll();
  void renderRoomJoinLinks(roomId);
  await showWaitingRoom();
}

async function showWaitingRoom() {
  if (!state.activeRoomId) return;

  $("#waiting-error").textContent = "";
  $("#waiting-room-id").textContent = formatRoomCode(state.activeRoomId);
  await refreshWaitingClassRoster();
  const roster = getWaitingClassRoster();
  updateWaitingStudentCount(0, roster.length || state.waitingTotalTarget || 0);
  updateWaitingGridLayout(roster.length || state.waitingTotalTarget || 1);
  updateWaitingStartButton();
  startWaitingTimer();
  goTo("waiting", "waiting");
  initWaitingClockLottie();

  if (!hostSessionConnected) void startWaitingPoll();
  void renderRoomJoinLinks(state.activeRoomId);
}

async function enterWaitingRoom(roomId, apiResponse) {
  await setupClassSession(roomId, apiResponse);
}

async function endActiveClassSession() {
  if (!state.activeRoomId) return;

  if (state.quizActive) {
    try {
      await wrapUpRoomExercisePromise();
    } catch {
      /* best effort */
    }
  }

  try {
    await api("/api/session/end", {
      method: "POST",
      body: {
        roomId: state.activeRoomId,
        class: state.classItem,
        user: state.user,
      },
    });
  } catch {
    /* session may already be gone */
  }

  stopWaitingPoll();
  disconnectHostSession();
  state.activeRoomId = null;
  state.quizActive = false;
}

async function leaveCourseForClassMenu() {
  playPageBackSound();
  await endActiveClassSession();
  state.course = null;
  state.selectedSection = null;
  savePrefs();
  enterClassStep();
}

async function createWaitingRoomForClass() {
  if (!state.classItem?.id || !state.user?.id || classSessionCreating) return;

  classSessionCreating = true;
  $("#class-error").textContent = "";
  $("#class-status").textContent = "Creating waiting room…";

  stopWaitingPoll();
  disconnectHostSession();
  state.activeRoomId = null;
  state.quizActive = false;

  try {
    const result = await api("/api/session/start", {
      method: "POST",
      body: {
        class: state.classItem,
        user: state.user,
      },
    });

    const roomId =
      result.roomId ||
      result.sessionId ||
      result.notification?.data?.session_id ||
      "";

    await setupClassSession(roomId, result.apiResponse);
  } catch (err) {
    $("#class-error").textContent = err.message;
  } finally {
    classSessionCreating = false;
    $("#class-status").textContent = "";
  }
}

function wrapUpRoomExercisePromise() {
  return new Promise((resolve) => {
    wrapUpRoomExercise((res) => resolve(res));
  });
}

async function launchHostExercise(exercise, {
  button = null,
  errorElement = $("#journey-error"),
  idleText = "Start exercise",
  playIntro = true,
} = {}) {
  if (!exercise?.id || !state.activeRoomId) return;

  if (errorElement) errorElement.textContent = "";
  if (button) {
    button.disabled = true;
    button.textContent = "Starting…";
  }

  try {
    if (state.quizActive) {
      await wrapUpRoomExercisePromise();
    }

    if (playIntro) {
      await playStartSessionSound();
      if (shouldPlayHostMcQuizCountdown(exercise)) {
        await playExerciseCountdownVideo();
      }
    }

    await startNextExerciseViaSocket(state.activeRoomId, exercise, state.course);
    state.selectedExercise = exercise;
    state.quizActive = true;
    syncPersistentRoomCode();
    await runHostExercise(state.activeRoomId, exercise);
    syncPersistentRoomCode();
  } catch (err) {
    state.quizActive = false;
    if (errorElement) errorElement.textContent = err.message;
    if (button) {
      button.disabled = !exercise;
      button.textContent = idleText;
    }
    throw err;
  } finally {
    if (button) {
      button.disabled = !exercise;
      button.textContent = idleText;
    }
  }
}

async function handleStartSession() {
  if (!state.selectedExercise || !state.activeRoomId) return;

  playPageNextSound();
  void markHostExerciseSelected(state.selectedExercise.id);
  const btn = $("#btn-start-session");

  try {
    await launchHostExercise(state.selectedExercise, {
      button: btn,
      errorElement: $("#journey-error"),
      idleText: "Start exercise",
    });
  } catch {
    /* error shown in launchHostExercise */
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

  if (typeof stopHostVideoPlayback === "function") stopHostVideoPlayback();
  playPageNextSound();
  $("#waiting-error").textContent = "";
  if (state.selectedExercise?.id) {
    await markHostExerciseCompleted(state.selectedExercise.id);
  }
  state.selectedExercise = next;
  void markHostExerciseSelected(next.id);

  const buttons = [
    "#btn-host-quiz-next-exercise",
    "#btn-host-video-next-exercise",
  ];
  for (const sel of buttons) {
    const btn = $(sel);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Starting next exercise…";
    }
  }

  try {
    await launchHostExercise(next, {
      errorElement: $("#waiting-error"),
      idleText: "Next exercise",
      playIntro: false,
    });
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

function handleStartClass() {
  playPageNextSound();
  stopWaitingTimer();
  if (state.course?.id) {
    void enterSectionStep({ resume: true });
    return;
  }
  void enterCourseStep({ keepCourse: true });
}

function handleLogout() {
  if (typeof stopHostVideoPlayback === "function") stopHostVideoPlayback();
  fadeInHostBgm();
  stopWaitingPoll();
  disconnectHostSession();
  state.activeRoomId = null;
  state.quizActive = false;
  clearAuth();
  state.classItem = null;
  state.course = null;
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

$("#btn-back-login")?.addEventListener("click", () => {
  playPageBackSound();
  handleLogout();
});

document.querySelectorAll(
  "#btn-logout-course, #btn-logout-section, #btn-logout-waiting, #btn-logout-quiz, #btn-logout-results, #btn-logout-finished, #btn-logout-video"
).forEach((btn) => btn.addEventListener("click", handleLogout));

$("#btn-back-class").addEventListener("click", () => {
  void leaveCourseForClassMenu();
});

$("#btn-back-course-from-section").addEventListener("click", () => {
  playPageBackSound();
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

async function backFromWaiting() {
  playPageBackSound();
  stopWaitingTimer();
  await endActiveClassSession();
  state.classItem = null;
  state.course = null;
  state.selectedSection = null;
  savePrefs();
  enterClassStep();
}

$("#btn-back-journey")?.addEventListener("click", backFromWaiting);

document.querySelectorAll("#btn-back-waiting-preview, #btn-back-waiting-quiz, #btn-back-waiting-results").forEach((btn) =>
  btn.addEventListener("click", () => {
    playPageBackSound();
    returnHostToJourney();
  })
);

document.querySelectorAll("#btn-back-waiting-finished").forEach((btn) =>
  btn.addEventListener("click", () => {
    playPageBackSound();
    wrapUpRoomExercise(() => {
      returnHostToJourney();
    });
  })
);

document.querySelectorAll("#btn-back-waiting-video, #btn-back-waiting-buzzin, #btn-back-waiting-buzzin-feedback").forEach((btn) =>
  btn.addEventListener("click", () => {
    playPageBackSound();
    finishVideoOrBuzzinExercise();
  })
);

$("#btn-start-session").addEventListener("click", handleStartSession);

$("#btn-start-class").addEventListener("click", handleStartClass);

$("#btn-open-waiting-course")?.addEventListener("click", () => {
  playPageNextSound();
  void showWaitingRoom();
});
$("#btn-open-waiting-section")?.addEventListener("click", () => {
  playPageNextSound();
  void showWaitingRoom();
});

async function copyRoomCode({ sourceId, buttonId, hintId, errorId }) {
  const source = sourceId ? $(`#${sourceId}`) : null;
  const roomId = normalizePin(source?.textContent || state.activeRoomId);
  if (!roomId) return;
  try {
    await navigator.clipboard.writeText(roomId);
    const btn = buttonId ? $(`#${buttonId}`) : null;
    const hint = hintId ? $(`#${hintId}`) : null;
    const prevTitle = btn?.title;
    if (btn) btn.title = "Copied!";
    if (hint) hint.textContent = "Copied!";
    setTimeout(() => {
      if (btn) btn.title = prevTitle || "Copy room code";
      if (hint) hint.textContent = "Tap to copy";
    }, 1500);
  } catch {
    const errorEl = errorId ? $(`#${errorId}`) : $("#waiting-error");
    if (errorEl) errorEl.textContent = "Could not copy room code.";
  }
}

$("#btn-copy-room-id").addEventListener("click", () => {
  void copyRoomCode({
    sourceId: "waiting-room-id",
    buttonId: "btn-copy-room-id",
    hintId: "waiting-room-code-hint",
    errorId: "waiting-error",
  });
});

$("#btn-copy-persistent-room-id")?.addEventListener("click", () => {
  void copyRoomCode({
    sourceId: "persistent-room-id",
    buttonId: "btn-copy-persistent-room-id",
    hintId: "persistent-room-code-hint",
    errorId: "waiting-error",
  });
});

function resetSessionAndGoToJourney() {
  returnHostToJourney();
}

$("#btn-start-another").addEventListener("click", () => {
  playPageNextSound();
  resetSessionAndGoToJourney();
});
$("#btn-start-another-quiz")?.addEventListener("click", () => {
  playPageNextSound();
  resetSessionAndGoToJourney();
});

function showHostExerciseFinishedScreen(payload) {
  if (typeof stopHostVideoPlayback === "function") stopHostVideoPlayback();
  fadeInHostBgm();
  markCurrentHostExerciseCompleted();
  showExerciseLeaderboards({
    exerciseLeaderboard: payload?.exerciseLeaderboard,
    semesterLeaderboard: payload?.semesterLeaderboard,
    exerciseListEl: $("#host-quiz-final-leaderboard"),
    semesterListEl: $("#host-semester-leaderboard"),
    semesterWrapEl: $("#host-semester-leaderboard-wrap"),
    exerciseWrapEl: $("#host-exercise-leaderboard-wrap"),
  });
  refreshNextExerciseUi();
  showScreen("host-quiz-finished");
  setActiveStep("quiz");
}

function wrapUpRoomExercise(callback) {
  const roomId = state.activeRoomId;
  if (!roomId || typeof getHostSessionSocket !== "function") {
    callback?.();
    return;
  }

  const exercise = state.selectedExercise;
  getHostSessionSocket().emit("end_room_exercise", {
    roomId,
    exerciseId: exercise?.id,
    exerciseType: exercise?.type,
  }, (res) => {
    callback?.(res);
  });
}

function returnHostToJourney() {
  if (typeof stopHostVideoPlayback === "function") stopHostVideoPlayback();
  fadeInHostBgm();
  state.quizActive = false;
  state.selectedExercise = null;
  updateWaitingStartButton();
  refreshNextExerciseUi();

  if (state.course?.id) {
    goTo("section", "section");
    renderSectionPicker();
    void showSectionExercises();
    return;
  }
  void enterCourseStep();
}

function finishVideoOrBuzzinExercise() {
  wrapUpRoomExercise((res) => {
    if (res?.ok && (res.semesterLeaderboard?.length || res.exerciseLeaderboard?.length)) {
      showHostExerciseFinishedScreen(res);
      return;
    }
    returnHostToJourney();
  });
}

function backToWaitingFromExercise() {
  finishVideoOrBuzzinExercise();
}

$("#btn-host-quiz-done")?.addEventListener("click", () => {
  playPageBackSound();
  markCurrentHostExerciseCompleted();
  wrapUpRoomExercise(() => {
    returnHostToJourney();
  });
});

$("#btn-host-fast-results-done")?.addEventListener("click", () => {
  playPageBackSound();
  markCurrentHostExerciseCompleted();
  wrapUpRoomExercise(() => {
    returnHostToJourney();
  });
});

$("#btn-host-video-done")?.addEventListener("click", () => {
  playPageNextSound();
  backToWaitingFromExercise();
});
$("#btn-host-buzzin-done")?.addEventListener("click", () => {
  playPageNextSound();
  backToWaitingFromExercise();
});
$("#btn-host-buzzin-feedback-done")?.addEventListener("click", () => {
  playPageNextSound();
  backToWaitingFromExercise();
});
$("#btn-start-another-video")?.addEventListener("click", () => {
  playPageNextSound();
  resetSessionAndGoToJourney();
});

document.querySelectorAll(
  "#btn-host-quiz-next-exercise, #btn-host-fast-results-next-exercise, #btn-host-video-next-exercise"
).forEach((btn) => btn.addEventListener("click", () => void handleStartNextExercise()));

$("#login-username").addEventListener("change", () => {
  state.loginUsername = $("#login-username").value.trim().toLowerCase();
  savePrefs();
});

loadPrefs();
applyLoginUsernameToForm();
setupHostMuteButton();
updateHostMuteButton();
setupHostBgm({ autostart: !hostBgmMuted });
initPersistentRoomCodeSync();
if (state.token && state.user) savePrefs();

const hostPreviewMode = new URLSearchParams(window.location.search).has("preview");

if (hostPreviewMode) {
  /* host-preview.js drives the UI — no login or socket session. */
} else if (state.token && state.user) {
  enterClassStep();
} else {
  goTo("login", "login");
}
