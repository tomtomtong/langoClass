// Autoclass (internal test): a class that runs itself from one lesson video.
//
// The lesson is a HyperFrames render plus a cues file, both made by the render container from a
// saved lesson script (docs/autoclass-step2-plan.md) and loaded by id: ?lesson=<id> reads
// /api/autoclass/lessons/<id>/cues, the render the lesson last published:
//   { "video": "...mp4", "cues": [{ "at": 37, "exercise": { id, type: "mcquiz", title, items } }] }
// A cue can be a poll instead of a question: { "at": 59, "poll": { id, question, options, seconds } }.
// Or "say it with me": { "at": 48, "speak": { sentence, seconds }, "exercise": { type: "openanswer", practice: true } }
// (see "Speak" below).
// Or a spelling race: { "at": 70, "spell": { id, seconds, words: [{ word, emoji, hint }] } } (see "Spell" below).
// The video does not show a poll; this page draws it over the paused video (see "Poll" below).
// The video shows each question itself and pauses on it at `at`. This page sends that quiz to
// the phones with the same room events host.html uses (start_next_exercise, create_room_game,
// start_room_game, next_question), waits for the results, then plays on into the reveal.
// Between questions the phones show the usual "watch the big screen" screen (a video exercise).
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const LESSON = params.get("lesson") || "animal-homes";
  const AUTOSTART = /^(1|true|yes)$/i.test(params.get("autostart") || "");
  // Waiting room before an autostart class: seconds to let people scan in (?lobby=<seconds>, default 60).
  const LOBBY_SECONDS = Math.max(0, Number(params.get("lobby")) || 60);
  const CUES_URL = `/api/autoclass/lessons/${encodeURIComponent(LESSON)}/cues`;
  const PREF_KEYS = ["lango_host_prefs", "lango_host_prefs_hk"];
  const RESULT_HOLD_MS = 1500;
  const CLOSE_WAIT_MS = 3000;

  const el = (id) => document.getElementById(id);
  const video = el("lesson-video");

  const state = {
    lesson: null,
    token: "",
    user: null,
    classes: [],
    classItem: null,
    roomId: "",
    socket: null,
    participants: [],
    cueIndex: 0,
    quiz: null, // { cue, endsAt, clockOffset, timer }
    totals: new Map(), // playerId -> { name, score }
    ended: false,
    hands: new Map(), // askId -> { name }: questions for Uncle Tommy, heard but not yet answered
    answers: [], // answers made and waiting for a quiet moment
    answered: 0,
    usedBreaks: new Set(),
    asking: false, // whether the phones currently show the hand button
    pendingResult: null, // { cue, payload }: a question's results, shown when the video reaches cue.result.at
    highlights: null, // { cue, picks, ready }: the best answers to an open question, read out on its results page
    picker: window.LangoAutoclassAnalysis ? window.LangoAutoclassAnalysis.makePicker() : null,
  };

  function showError(message) {
    el("setup-error").textContent = message || "";
    el("scene-error").textContent = message || ""; // the waiting room has no setup card to show it in
  }

  // ---- Sign-in reuse: the host page keeps the teacher's token in localStorage. ----

  function loadHostLogin() {
    for (const key of PREF_KEYS) {
      try {
        const data = JSON.parse(localStorage.getItem(key) || "null");
        if (data?.token && data?.user?.id) return { token: data.token, user: data.user };
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (state.user?.id) headers["X-Teacher-Id"] = String(state.user.id);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw new Error(data?.message || data?.error || `Request failed (${res.status}).`);
    return data;
  }

  // ---- Socket helpers: every room event acks; turn the acks into promises. ----

  function emit(event, data = {}) {
    return new Promise((resolve, reject) => {
      state.socket.emit(event, { roomId: state.roomId, ...data }, (res) => {
        if (res && res.ok === false) reject(new Error(res.error || `${event} failed.`));
        else resolve(res || {});
      });
    });
  }

  function connectRoom(roomId) {
    const socket = io({ transports: ["websocket", "polling"] });
    state.socket = socket;
    socket.on("session_lobby_update", (data) => renderParticipants(data?.participants || []));
    socket.on("question_preview", () => setLive("Get ready…", ""));
    // The video already shows the question, so open answers straight away instead of waiting
    // for Uncle Tommy's reading.
    socket.on("question_speaking", (data) => {
      // A question the phones are already looking at (view only, see startPreview) waits for the
      // page to pause; then runCue opens the answers.
      if (state.preview && !state.quiz) {
        state.preview.speaking = data;
        return;
      }
      setLive("Get ready…", "");
      state.socket.emit("question_tts_done", { questionIndex: data?.questionIndex });
    });
    socket.on("question_start", onQuestionStart);
    socket.on("answer_count", onAnswerCount);
    socket.on("question_results", onQuestionResults);
    socket.on("reaction", showReaction);
    socket.on("poll_votes", onPollVotes);
    socket.on("spell_progress", onSpellProgress);
    socket.on("ask_received", onAskReceived);
    socket.on("tutor_answer", onTutorAnswer);
    socket.on("tutor_declined", onTutorDeclined);
    socket.on("openanswer_update", onSpeakUpdate);
    socket.on("openanswer_closed", onSpeakClosed);
    socket.on("openanswer_highlights", onHighlights);
    socket.on("result_cheer", onCheer);
    socket.io?.on?.("reconnect", () => emit("host_session", hostSessionData()).catch(() => {}));

    return new Promise((resolve, reject) => {
      socket.once("connect", () => {
        emit("host_session", hostSessionData())
          .then((res) => {
            renderParticipants(res.participants || []);
            resolve();
          })
          .catch(reject);
      });
      socket.once("connect_error", () => reject(new Error("Could not connect to the class server.")));
      socket.connect(roomId);
    });
  }

  function renderParticipants(list) {
    state.participants = list;
    const online = list.filter((p) => p.online !== false);
    el("joined-count").textContent = String(online.length);
    const onlineEl = el("roomcard-online-count"); // the top-right card shows how many are in, all class long
    if (onlineEl.textContent !== String(online.length)) {
      onlineEl.textContent = String(online.length);
      onlineEl.classList.remove("pop");
      void onlineEl.offsetWidth;
      onlineEl.classList.add("pop");
    }
    el("joined-names").textContent = online.map((p) => p.displayName || p.name).join(", ") || "nobody yet";
    renderLobbyPlayers(online);
  }

  // The waiting room's "connected students" panel, like the host's: a round coloured badge with the
  // initials and the name for each person in, in the order they came; a ding for each new arrival.
  const lobbySeen = new Set();
  let lobbyPrimed = false;
  function renderLobbyPlayers(online) {
    const grid = el("scene-players");
    const people = online.map((p) => ({ id: String(p.userId ?? p.id ?? p.displayName ?? p.name), name: p.displayName || p.name || "?" }));
    const fresh = new Set(people.filter((p) => !lobbySeen.has(p.id)).map((p) => p.id));
    fresh.forEach((id) => lobbySeen.add(id));
    if (fresh.size && lobbyPrimed && !el("setup").hidden) playLobbySound("/assets/soundeffect/login_success.mp3", 0.5);
    lobbyPrimed = true;

    const count = el("scene-count");
    if (count.textContent !== String(people.length)) {
      count.textContent = String(people.length);
      count.classList.remove("pop");
      void count.offsetWidth; // restart the pop
      count.classList.add("pop");
    }
    el("scene-wait").hidden = people.length > 0;
    grid.textContent = "";
    for (const p of people) {
      const li = document.createElement("li");
      li.className = `lw-student${fresh.has(p.id) ? " pop" : ""}`;
      const badge = document.createElement("span");
      badge.className = "lw-avatar";
      badge.style.setProperty("--hue", String([...p.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 17)));
      const initials = document.createElement("span");
      initials.className = "lw-initials";
      initials.textContent = initialsOf(p.name);
      badge.appendChild(initials);
      const name = document.createElement("span");
      name.className = "lw-name";
      name.textContent = p.name;
      li.append(badge, name);
      grid.appendChild(li);
    }
    if (fresh.size) grid.scrollTop = grid.scrollHeight;
  }

  // Short sounds in the waiting room. The browser may refuse until someone has clicked the page; then it is silent.
  function playLobbySound(src, volume) {
    try {
      const audio = new Audio(src);
      audio.volume = volume;
      audio.play().catch(() => {});
    } catch {
      /* no sound */
    }
  }

  // The students' join page takes the lesson's look (for example big type for older learners).
  // The teacher can override it on the setup page (kept on this device); "standard" is no theme.
  const LOOK_KEY = "lango_autoclass_look";
  function chosenTheme() {
    const look = el("look-select")?.value || "";
    if (look === "standard") return "";
    return look || state.lesson?.theme || "";
  }

  // ---- Background: a colour or a blurred photo behind the lesson, changed any time. Only when the
  // lesson has a see-through video (cues.videoAlpha) and the browser plays it; otherwise the
  // lesson's own light-blue background stays. A photo is blurred and washed out so it never
  // competes with the lesson. ----

  const BG_KEY = "lango_autoclass_bg";
  const BACKGROUNDS = [
    ["Light blue (default)", ""],
    ["Cream", "color:#fff3df"],
    ["Mint", "color:#e1f6ec"],
    ["Rose", "color:#ffe6f0"],
    ["Lavender", "color:#eee8ff"],
    ["Sunny yellow", "color:#fff4c2"],
    ["Photo: classroom (blurred)", "photo:/assets/waiting/bg.jpg"],
    ["Photo: meadow and sky (blurred)", "photo:/assets/class/bg.jpg"],
    ["Your own photo…", "custom"],
  ];

  // Chrome, Edge and Firefox play a WebM with a see-through background; Safari does not.
  function playsSeeThrough() {
    const ua = navigator.userAgent;
    return !(/safari/i.test(ua) && !/chrome|chromium|crios|edg|android/i.test(ua));
  }

  let customPhotoUrl = "";

  function applyBackground(value) {
    const layer = el("bg-layer");
    layer.style.removeProperty("--bg-photo");
    layer.style.removeProperty("--bg-wash");
    layer.style.background = "";
    if (value.startsWith("color:")) {
      layer.style.background = value.slice(6);
    } else if (value.startsWith("photo:") || (value === "custom" && customPhotoUrl)) {
      layer.style.setProperty("--bg-photo", `url("${value === "custom" ? customPhotoUrl : value.slice(6)}")`);
      layer.style.setProperty("--bg-wash", "0.3");
      layer.style.background = "#eaf1ff";
    }
  }

  function chooseBackground(value) {
    if (value === "custom" && !customPhotoUrl) {
      el("bg-file").click();
      return;
    }
    applyBackground(value);
    // A photo from this computer is not remembered, only the choice of a colour or a built-in photo.
    try {
      if (value !== "custom") localStorage.setItem(BG_KEY, value);
    } catch {
      /* private mode */
    }
    for (const id of ["bg-select", "bg-live"]) el(id).value = value;
  }

  // How blurred a photo is (0 to 24 px), changed any time; the default shows the photo fairly clearly.
  const BLUR_KEY = "lango_autoclass_bgblur";
  function setBlur(px, { save = true } = {}) {
    const value = Math.max(0, Math.min(24, Math.round(Number(px)) || 0));
    el("bg-layer").style.setProperty("--bg-blur", `${value}px`);
    for (const id of ["bg-blur", "bg-blur-live"]) el(id).value = String(value);
    if (!save) return;
    try {
      localStorage.setItem(BLUR_KEY, String(value));
    } catch {
      /* private mode */
    }
  }

  function initBackground(alpha) {
    el("frame").classList.toggle("has-alpha", alpha);
    el("bg-step").hidden = !alpha;
    el("bg-live").hidden = !alpha;
    el("bg-blur-live").hidden = !alpha;
    if (!alpha) return;
    let savedBlur = 8;
    try {
      const raw = localStorage.getItem(BLUR_KEY);
      if (raw !== null) savedBlur = Number(raw);
    } catch {
      /* private mode */
    }
    setBlur(savedBlur, { save: false });
    for (const id of ["bg-blur", "bg-blur-live"]) el(id).addEventListener("input", () => setBlur(el(id).value));
    for (const id of ["bg-select", "bg-live"]) {
      const select = el(id);
      select.innerHTML = BACKGROUNDS.map(([label, value]) => `<option value="${value}">${label}</option>`).join("");
      select.addEventListener("change", () => chooseBackground(select.value));
    }
    el("bg-file").addEventListener("change", () => {
      const file = el("bg-file").files?.[0];
      if (!file) return;
      if (customPhotoUrl) URL.revokeObjectURL(customPhotoUrl);
      customPhotoUrl = URL.createObjectURL(file);
      chooseBackground("custom");
    });
    let saved = "";
    try {
      saved = localStorage.getItem(BG_KEY) || "";
    } catch {
      /* private mode */
    }
    chooseBackground(BACKGROUNDS.some(([, value]) => value === saved) && saved !== "custom" ? saved : "");
  }

  function hostSessionData() {
    return { uiLocale: "en", theme: chosenTheme() };
  }

  function initLookChoice() {
    const select = el("look-select");
    try {
      const saved = localStorage.getItem(LOOK_KEY);
      if (saved != null && [...select.options].some((o) => o.value === saved)) select.value = saved;
    } catch {
      /* private mode */
    }
    select.addEventListener("change", () => {
      try {
        localStorage.setItem(LOOK_KEY, select.value);
      } catch {
        /* private mode */
      }
      // Once the room is open the phones follow at once.
      if (state.socket) emit("host_session", hostSessionData()).catch(() => {});
    });
  }

  // ---- Setup ----

  async function init() {
    initLookChoice();
    try {
      const res = await fetch(CUES_URL, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `No lesson "${LESSON}".`);
      }
      state.lesson = await res.json();
      const polls = state.lesson.cues.filter((cue) => cue.poll).length;
      const speaks = state.lesson.cues.filter((cue) => cue.speak).length;
      const spells = state.lesson.cues.filter((cue) => cue.spell).length;
      el("setup-lesson").textContent =
        `Lesson: ${state.lesson.title} · ${state.lesson.cues.length - polls - speaks - spells} questions` +
        (speaks ? ` · ${speaks} speaking` : "") +
        (spells ? ` · ${spells} spelling race${spells > 1 ? "s" : ""}` : "") +
        (polls ? ` · ${polls} poll${polls > 1 ? "s" : ""}` : "");
      const seeThrough = Boolean(state.lesson.videoAlpha) && playsSeeThrough();
      initBackground(seeThrough);
      void loadVideo(seeThrough ? state.lesson.videoAlpha : state.lesson.video);
    } catch (err) {
      showError(err.message);
      return;
    }

    const login = loadHostLogin();
    if (!login) {
      el("signin-needed").hidden = false;
      return;
    }
    state.token = login.token;
    state.user = login.user;

    try {
      state.classes = extractClassList(await api("/api/lango/classList"));
    } catch (err) {
      showError(`Could not load classes: ${err.message}`);
      return;
    }
    if (!state.classes.length) {
      showError("This account has no classes.");
      return;
    }
    const select = el("class-select");
    select.innerHTML = state.classes
      .map((c) => `<option value="${String(c.id).replace(/"/g, "&quot;")}">${escapeText(c.name || c.class_name || c.id)}</option>`)
      .join("");
    el("class-step").hidden = false;
    if (AUTOSTART) void autoStart();
  }

  // ?autostart=1 (the demo page, autoclass-demo.html): no clicks. Picks the class (?class=<name or id>,
  // else the first), opens the room, shows a waiting room (big QR code, PIN, how many have joined,
  // and a countdown) for ?lobby=<seconds>, then starts the class once the video is ready. The Start
  // button skips the wait. If the browser refuses to play with sound, the first click in the page
  // starts the video.
  async function autoStart() {
    const wanted = params.get("class");
    if (wanted) {
      const match = state.classes.find((c) => String(c.id) === wanted || String(c.name || c.class_name) === wanted);
      if (match) el("class-select").value = String(match.id);
    }
    el("setup").classList.add("lobby", "lw-loading"); // the scene waits, empty, until the room is open
    await openRoom();
    if (!state.roomId) {
      el("setup").classList.remove("lobby", "lw-loading"); // show the setup card and its error
      return;
    }

    const deadline = Date.now() + LOBBY_SECONDS * 1000;
    const timer = el("scene-timer");
    const label = el("scene-timer-label");
    for (;;) {
      if (el("setup").hidden) return; // someone pressed Start class
      const left = Math.max(0, deadline - Date.now());
      const secs = Math.ceil(left / 1000);
      label.textContent = left > 0 || state.videoReady ? "開始倒數" : "準備緊";
      timer.textContent = `${String(Math.floor(secs / 60)).padStart(2, "0")} : ${String(secs % 60).padStart(2, "0")}`;
      if (left <= 0 && state.videoReady) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    playLobbySound("/assets/soundeffect/uncletommy_letsgo_1.mp3", 0.9);
    await startClass();
    if (video.paused) {
      document.addEventListener("click", () => video.play().catch(() => {}), { once: true });
    }
  }

  // Stream the lesson instead of downloading it all first (a 25 MB render took most of a minute on
  // a slow network). R2 serves ranges (worker/uploads.js) and the renders put the moov box first,
  // so the video can seek exactly to each cue. Start is allowed once the browser expects to play
  // through; it keeps buffering ahead with preload="auto", including while the video is paused on
  // a quiz.
  function loadVideo(url) {
    const label = el("setup-lesson");
    const base = label.textContent;
    const start = el("start-class");
    start.disabled = true;
    state.videoReady = false;
    const ready = () => {
      if (state.videoReady) return;
      state.videoReady = true;
      start.disabled = false;
      label.textContent = `${base} · video ready`;
    };
    video.addEventListener("canplaythrough", ready, { once: true });
    video.addEventListener("progress", () => {
      if (state.videoReady || !video.duration || !video.buffered.length) return;
      const loaded = video.buffered.end(video.buffered.length - 1) / video.duration;
      label.textContent = `${base} · loading video ${Math.round(loaded * 100)}%`;
    });
    video.addEventListener("error", () => showError(`Could not load the lesson video (${video.error?.code ?? "?"}).`), { once: true });
    video.preload = "auto";
    video.src = url;
  }

  function escapeText(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  async function openRoom() {
    const button = el("open-room");
    button.disabled = true;
    showError("");
    try {
      state.classItem = state.classes.find((c) => String(c.id) === el("class-select").value) || state.classes[0];
      const result = await api("/api/session/start", {
        method: "POST",
        body: { class: state.classItem, user: state.user, uiLocale: "en" },
      });
      state.roomId = result.roomId || result.sessionId;
      await connectRoom(state.roomId);
      // Turn on the emoji bar on the students' join page for this room.
      await emit("set_reactions", { enabled: true }).catch((err) => console.warn("autoclass: reactions", err));
      await syncAsking();
      const joinUrl = studentJoinUrl(location.origin, { roomId: state.roomId });
      el("room-link").href = joinUrl;
      el("room-link").textContent = joinUrl;
      el("room-pin").textContent = state.roomId;
      el("live-pin").textContent = `PIN ${state.roomId}`;
      el("room-qr").src = `/api/room-qr.svg?url=${encodeURIComponent(joinUrl)}`;
      el("roomcard-qr").src = el("room-qr").src;
      el("roomcard-code").textContent = formatRoomCode(state.roomId);
      el("class-step").hidden = true;
      el("room-step").hidden = false;
      enterWaitingRoom();
      startBgm(); // the room is waiting (the video is paused), so this plays until the class starts
    } catch (err) {
      showError(err.message);
      button.disabled = false;
    }
  }

  // The room is open: show the host-style waiting room (code card with QR, who has joined, Start).
  // Started by hand (Open room) it has no countdown; autoStart adds one.
  let waitingRoomWired = false;
  function enterWaitingRoom() {
    const setup = el("setup");
    setup.classList.add("lobby");
    setup.classList.remove("lw-loading");
    setup.classList.toggle("untimed", !AUTOSTART);
    el("scene-pin").textContent = state.roomId;
    el("scene-qr").src = el("room-qr").src;
    el("scene-lesson").textContent = state.lesson?.title ? `今堂：${state.lesson.title}` : "";
    const start = el("scene-start");
    start.textContent = AUTOSTART ? "即刻開始" : "開始上堂";
    if (waitingRoomWired) return;
    waitingRoomWired = true;
    start.addEventListener("click", () => el("start-class").click());
    // The Start button follows the lesson video: not before it can play through.
    const sync = setInterval(() => {
      if (setup.hidden) return clearInterval(sync);
      start.disabled = !state.videoReady;
    }, 250);
  }

  // ---- Running the class ----

  const WATCH_EXERCISE = () => ({
    id: `autoclass-watch-${LESSON}`,
    type: "video",
    title: state.lesson?.title || "Watch the big screen",
    items: [],
  });

  // ---- Background music: soft music while the class is waiting (answers open, results, a vote), so
  // the room is never silent. It stays out of the way: silent while the lesson video plays (Tommy
  // and the song clips need the air) and lower while Tommy talks on a results page or answers a
  // question. The level and mute come from the host's sound settings on this device, and the
  // Music button mutes it. ----

  const BGM_TRACKS = [
    { src: "/assets/bgm/BGM_1.mp3", trim: 1 },
    { src: "/assets/bgm/BGM_2.mp3", trim: 0.68 }, // mastered hotter than BGM_1
  ];
  const BGM_DEFAULT_VOLUME = 0.5; // when the host page has no saved level (it used to be 0.2: too quiet to notice)
  const BGM_MUTE_KEY = "lango_autoclass_bgm_muted";
  const bgm = { audio: null, trim: 1, level: 0, timer: null, muted: false };

  function hostSoundPrefs() {
    for (const key of PREF_KEYS) {
      try {
        const data = JSON.parse(localStorage.getItem(key) || "null");
        if (data) return data;
      } catch {
        /* ignore */
      }
    }
    return {};
  }

  function bgmTarget() {
    if (state.ended || bgm.muted) return 0;
    const prefs = hostSoundPrefs();
    if (prefs.bgmMuted || prefs.soundMuted) return 0;
    const base = Number.isFinite(Number(prefs.bgmVolume)) && prefs.bgmVolume !== undefined ? Math.max(0, Math.min(1, Number(prefs.bgmVolume))) : BGM_DEFAULT_VOLUME;
    const playing = !video.paused && !state.quiz;
    if (playing) return 0;
    const talking = tutorBusy || resultBusy;
    return base * bgm.trim * (talking ? 0.4 : 1);
  }

  function bgmTick() {
    const audio = bgm.audio;
    if (!audio) return;
    const target = bgmTarget();
    // A gentle fade: about a second from silence to full.
    bgm.level += Math.max(-0.04, Math.min(0.04, target - bgm.level));
    audio.volume = Math.max(0, Math.min(1, bgm.level));
    if (bgm.level < 0.002 && target === 0) {
      if (!audio.paused) audio.pause();
    } else if (audio.paused) {
      audio.play().catch(() => {});
    }
    if (state.ended && bgm.level < 0.002) stopBgm();
  }

  function startBgm() {
    if (bgm.audio) return;
    try {
      bgm.muted = localStorage.getItem(BGM_MUTE_KEY) === "1";
    } catch {
      bgm.muted = false;
    }
    const track = BGM_TRACKS[Math.floor(Math.random() * BGM_TRACKS.length)];
    bgm.trim = track.trim;
    bgm.audio = new Audio(track.src);
    bgm.audio.loop = true;
    bgm.audio.volume = 0;
    bgm.level = 0;
    bgm.timer = setInterval(bgmTick, 100);
    renderMusicButton();
  }

  function stopBgm() {
    clearInterval(bgm.timer);
    bgm.timer = null;
    bgm.audio?.pause();
    bgm.audio = null;
  }

  function renderMusicButton() {
    const label = bgm.muted ? "🔇 Music off" : "🎵 Music";
    el("btn-music").textContent = label;
    el("lobby-music").textContent = label;
    el("scene-music").textContent = label;
  }

  function toggleMusic() {
    bgm.muted = !bgm.muted;
    try {
      localStorage.setItem(BGM_MUTE_KEY, bgm.muted ? "1" : "0");
    } catch {
      /* private mode */
    }
    renderMusicButton();
  }

  async function startClass() {
    el("start-class").disabled = true;
    showError("");
    try {
      await emit("start_next_exercise", { exercise: WATCH_EXERCISE() });
    } catch (err) {
      showError(err.message);
      el("start-class").disabled = false;
      return;
    }
    el("setup").hidden = true;
    el("stage").hidden = false;
    showRoomCard();
    state.cueIndex = 0;
    video.currentTime = 0;
    startBgm();
    preloadTommyMoods();
    await video.play().catch(() => {});
    requestAnimationFrame(watchForCue);
  }

  // timeupdate fires only ~4 times a second; a frame loop stops within one frame of the cue.
  function watchForCue() {
    if (state.ended) return;
    const cue = state.lesson.cues[state.cueIndex];
    // A question's results come before whatever cue follows it, even if this loop was slow to notice
    // (a window in the background runs it only about once a second).
    if (cue && !state.quiz && !state.preview && !video.paused && isMcCue(cue) && cue.previewAt != null
      && video.currentTime >= cue.previewAt && video.currentTime < cue.at) {
      startPreview(cue);
    }
    if (resultDue()) {
      void runResult();
    } else if (cue && !state.quiz && !video.paused && video.currentTime >= cue.at) {
      video.pause();
      video.currentTime = cue.at;
      // Tommy has just finished asking: a student's question can be answered first, then the question
      // opens. Not when the phones already have this question (view only): their clock is running.
      if (answerWaiting() && !state.preview) void runTutor();
      else void runCue(cue);
    } else {
      const quietAt = takeBreak();
      if (quietAt !== null) void runTutor();
    }
    if (!tutorBusy && !el("tutor").hidden) hideTutor(); // the card can never be left on screen
    if (!resultBusy && !el("result").hidden) hideResult(); // nor the results page
    requestAnimationFrame(watchForCue);
  }

  const isMcCue = (cue) => !cue.poll && !cue.spell && !cue.speak && !cue.ask && cue.exercise?.type === "mcquiz";

  async function runCue(cue) {
    if (cue.poll) return runPoll(cue);
    if (cue.spell) return runSpell(cue);
    if (cue.speak || cue.ask) return runSpeak(cue);
    const quiz = mcQuizPayloadFromExercise(cue.exercise);
    const pre = state.preview?.cue === cue && !state.preview.failed ? state.preview : null;
    state.preview = null;
    state.quiz = { cue, endsAt: 0, clockOffset: 0, timer: null };
    clearLost();
    el("btn-skip").textContent = "Skip question";
    el("btn-skip").hidden = false;
    setLive("Get ready…", "");
    try {
      if (pre) {
        // The phones have had the question for a few seconds already: open the answers now. If the
        // room has not said it is waiting yet, the question_speaking handler does it when it does.
        await pre.starting;
        if (pre.speaking) state.socket.emit("question_tts_done", { questionIndex: pre.speaking.questionIndex });
        return;
      }
      // A warm-up has no marking: the room just counts each go (worker/room-open-answer.js).
      await emit("start_next_exercise", { exercise: cue.exercise });
      await emit("create_room_game", { quiz });
      await emit("start_room_game");
    } catch (err) {
      console.warn("autoclass: could not start the quiz", err);
      setLive(`Could not send the question (${err.message}). Carrying on.`, "");
      setTimeout(() => finishCue(null), 2500);
    }
  }

  // Phones show a multiple-choice question (view only) while Tommy is still reading it on the big
  // screen: the room game starts here, and runCue opens the answers when the page pauses.
  function startPreview(cue) {
    const quiz = mcQuizPayloadFromExercise(cue.exercise);
    const pre = { cue, speaking: null, failed: false, starting: null };
    state.preview = pre;
    pre.starting = (async () => {
      try {
        await emit("start_next_exercise", { exercise: cue.exercise });
        await emit("create_room_game", { quiz });
        await emit("start_room_game");
      } catch (err) {
        console.warn("autoclass: could not preview the question", err);
        pre.failed = true;
      }
    })();
  }

  function onQuestionStart(data) {
    if (!state.quiz) return;
    state.quiz.clockOffset = Number(data.serverNow || Date.now()) - Date.now();
    state.quiz.endsAt = Number(data.endsAt) || Date.now() + (data.timeLimit || 15) * 1000;
    el("live").dataset.answered = "0";
    setLive(`0 of ${Math.max(1, onlineCount())} answered`, "");
    clearInterval(state.quiz.timer);
    const tick = () => {
      const left = Math.max(0, Math.ceil((state.quiz.endsAt - (Date.now() + state.quiz.clockOffset)) / 1000));
      el("live-timer").textContent = String(left);
    };
    tick();
    state.quiz.timer = setInterval(tick, 250);
  }

  // The strip counts the answers as they come in, with a pop each time that climbs as more arrive,
  // and a little fanfare when the last student is in.
  function onAnswerCount({ answered = 0, total = 0 } = {}) {
    const run = state.quiz;
    if (!run || run.speak || run.tutor || run.result || !total) return;
    const text = answered >= total ? `Everyone answered! ${answered} of ${total} 🎉` : `${answered} of ${total} answered`;
    const label = el("live-text");
    label.textContent = text;
    const live = el("live");
    const before = Number(live.dataset.answered || 0);
    live.dataset.answered = String(answered);
    setLiveFill(answered / total);
    live.classList.remove("is-bump");
    void live.offsetWidth;
    live.classList.add("is-bump");
    playAnswerSound(answered, total, before);
  }

  function onQuestionResults(payload) {
    if (!state.quiz) return;
    clearInterval(state.quiz.timer);
    for (const r of payload.results || []) {
      const entry = state.totals.get(r.playerId) || { name: r.name, score: 0 };
      entry.name = r.name || entry.name;
      entry.score += Number(r.points) || 0;
      state.totals.set(r.playerId, entry);
    }
    // Close the one-question game so its scores are saved, then put the phones back on "watch".
    // Wait until the room says the game is closed ("game_finished"; next_question has no ack):
    // sent together, the phones get the game's leaderboard after the watch screen and stay on
    // the leaderboard. Never wait long, so the class cannot hang.
    const cue = state.quiz.cue;
    const closed = new Promise((resolve) => state.socket.once("game_finished", resolve));
    const waitedEnough = new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS));
    emit("next_question").catch(() => {});
    Promise.race([closed, waitedEnough]).then(() => {
      if (state.quiz?.cue === cue) finishCue(payload); // not if "Skip question" got there first
    });
  }

  function phonesToWatch() {
    emit("start_next_exercise", { exercise: WATCH_EXERCISE() }).catch(() => {});
  }

  function finishCue(payload) {
    const cue = state.quiz?.cue;
    if (!cue) return;
    clearInterval(state.quiz.timer);
    state.quiz = null;
    state.cueIndex += 1;
    el("btn-skip").hidden = true;

    const results = payload?.results || [];
    const answered = results.filter((r) => r.answerIndex !== null && r.answerIndex !== undefined).length;
    if (results.length) {
      // How many took part, the same count the strip showed while the answers came in. Who got it
      // right is for the results page, after the reveal, so this strip does not give it away.
      setLive(`${answered} of ${results.length} answered`, "", true, answered / results.length);
    } else {
      setLive("", "");
    }
    // A skipped question (no payload), or a class with nobody in it, has no results to show.
    state.pendingResult = cue.result && results.length && window.LangoAutoclassAnalysis ? { cue, payload } : null;
    emit("start_next_exercise", { exercise: WATCH_EXERCISE() }).catch(() => {});
    setTimeout(() => {
      if (state.ended) return;
      video.currentTime = cue.resumeAt ?? cue.at;
      video.play().catch(() => {});
      // Keep the result up through the on-video reveal, then clear the strip.
      setTimeout(() => {
        if (!state.quiz) el("live").hidden = true;
      }, 6000);
    }, RESULT_HOLD_MS);
  }

  // ---- Poll: a question with no right answer, between two parts of the video. It gives no
  // points. This page draws it; the bars grow as the phones vote (worker/room-poll.js). ----

  const POLL_SECONDS = 20;
  const POLL_ALL_IN_MS = 1200; // after the last student votes
  const POLL_HOLD_MS = 4000; // the finished bars stay up this long

  function onlineCount() {
    return state.participants.filter((p) => p.online !== false).length;
  }

  function runPoll(cue) {
    const poll = cue.poll;
    const run = { cue, poll: true, timer: null, endsAt: Date.now() + (poll.seconds || POLL_SECONDS) * 1000, closing: false, audio: null, voters: 0 };
    state.quiz = run; // a poll holds the video the same way a question does
    clearLost();
    el("btn-skip").textContent = "Skip poll";
    el("btn-skip").hidden = false;
    el("poll-question").textContent = poll.question;
    el("poll-bars").innerHTML = poll.options
      .map((text) => `<li><span>${escapeText(text)}</span><span class="poll-track"><span class="poll-fill"></span></span><span class="poll-count">0</span></li>`)
      .join("");
    renderPollVotes({ counts: [], voters: 0 });
    el("poll").hidden = false;
    setLive("Vote on your phone", "");
    playPollAudio(run, poll.askAudio);
    emit("start_poll", { id: poll.id, question: poll.question, options: poll.options }).catch((err) => {
      console.warn("autoclass: could not start the poll", err);
      setLive(`Could not send the poll (${err.message}). Carrying on.`, "");
      setTimeout(() => finishPoll(cue), 2500);
    });
    const tick = () => {
      const left = Math.max(0, Math.ceil((run.endsAt - Date.now()) / 1000));
      el("live-timer").textContent = String(left);
      if (!left) closePoll(cue);
    };
    tick();
    run.timer = setInterval(tick, 250);
  }

  function onPollVotes(data = {}) {
    const run = state.quiz;
    if (!run?.poll || data.id !== run.cue.poll.id) return;
    renderPollVotes(data);
    const online = onlineCount();
    if (online && data.voters >= online) setTimeout(() => closePoll(run.cue), POLL_ALL_IN_MS);
  }

  // Each bar is that option's share of the class, so a bar only ever grows.
  function renderPollVotes({ counts = [], voters = 0 }) {
    const everyone = Math.max(onlineCount(), voters, 1);
    [...el("poll-bars").children].forEach((row, index) => {
      const count = counts[index] || 0;
      row.querySelector(".poll-fill").style.width = `${(count / everyone) * 100}%`;
      row.querySelector(".poll-count").textContent = String(count);
    });
    el("poll-voters").textContent = `${voters} of ${everyone} voted`;
    if (state.quiz?.poll) state.quiz.voters = voters;
  }

  // Time is up, or everyone has voted: stop taking votes and hold the bars for a moment.
  function closePoll(cue) {
    const run = state.quiz;
    if (!run?.poll || run.cue !== cue || run.closing) return;
    run.closing = true;
    clearInterval(run.timer);
    el("btn-skip").hidden = true;
    emit("end_poll").catch(() => {});
    setLive(run.voters ? "Thank you for voting!" : "No votes this time", "", true);
    playPollAudio(run, cue.poll.doneAudio);
    setTimeout(() => finishPoll(cue), POLL_HOLD_MS);
  }

  function finishPoll(cue) {
    const run = state.quiz;
    if (!run?.poll || run.cue !== cue) return;
    clearInterval(run.timer);
    if (!run.closing) emit("end_poll").catch(() => {}); // skipped
    run.audio?.pause();
    state.quiz = null;
    state.cueIndex += 1;
    el("btn-skip").hidden = true;
    el("poll").hidden = true;
    el("live").hidden = true;
    if (state.ended) return;
    video.currentTime = cue.resumeAt ?? cue.at;
    video.play().catch(() => {});
  }

  // Uncle Tommy's lines for a poll are separate files, because the video has no poll scene.
  function playPollAudio(run, url) {
    if (!url) return;
    run.audio?.pause();
    run.audio = new Audio(url);
    run.audio.play().catch(() => {});
  }

  // ---- Spell: a spelling race. The video shows the words' emojis with blanks and pauses; every
  // phone spells the words from scrambled tiles at its own pace (worker/room-spell.js), and each
  // right word scores. Like a poll it runs over the "watch" exercise, so the phones go straight
  // back to watching when it ends. The race ends when the time is up or everyone has spelled every
  // word; then the video writes the words in, and the results page shows who spelled them all.
  // Each student counts as option 0 (all spelled), 1 (some) or 2 (tried, none yet) of a
  // three-option question, so the results page and Tommy's quiz lines work as they do for a quiz. ----

  const SPELL_LATE_MS = 1500; // the room still takes answers sent just as the time runs out
  const SPELL_ALL_IN_MS = 1200; // after the last student has spelled every word
  const SPELL_OPTIONS = [
    { text: "Spelled them all", letter: "🏆" },
    { text: "Spelled some", letter: "✏️" },
    { text: "None yet", letter: "💪" },
  ];

  async function runSpell(cue) {
    const spell = cue.spell;
    const run = { cue, spell: true, timer: null, endsAt: Date.now() + (spell.seconds || 60) * 1000, closing: false, progress: null, allInTimer: null };
    state.quiz = run;
    clearLost();
    el("btn-skip").textContent = "Skip spelling";
    el("btn-skip").hidden = false;
    setLive("Get ready…", "");
    try {
      const started = await emit("start_spellrace", {
        id: spell.id,
        title: cue.exercise?.title || "Spelling race",
        seconds: spell.seconds,
        words: spell.words,
      });
      if (state.quiz !== run) return; // skipped meanwhile
      // The time left, not the room's clock: this computer's clock may be off.
      run.endsAt = Date.now() + (Number(started?.msLeft) || (spell.seconds || 60) * 1000);
    } catch (err) {
      console.warn("autoclass: could not start the spelling race", err);
      setLive(`Could not send the race (${err.message}). Carrying on.`, "");
      setTimeout(() => finishSpell(cue, null), 2500);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((run.endsAt - Date.now()) / 1000));
      el("live-timer").textContent = String(left);
      const p = run.progress;
      el("live-text").textContent = run.closing
        ? "Time's up!"
        : `Spell on your phone · ${p?.spelled || 0} words spelled` + (p?.finished ? ` · ${p.finished} spelled them all` : "");
      if (!left && !run.closing) setTimeout(() => closeSpell(cue), SPELL_LATE_MS);
    };
    tick();
    run.timer = setInterval(tick, 250);
  }

  function onSpellProgress(data = {}) {
    const run = state.quiz;
    if (!run?.spell || data.id !== run.cue.spell.id) return;
    run.progress = data;
    const online = onlineCount();
    if (online && data.finished >= online && !run.allInTimer) run.allInTimer = setTimeout(() => closeSpell(run.cue), SPELL_ALL_IN_MS);
  }

  // Time is up, or everyone has spelled every word: end the race and keep its results.
  async function closeSpell(cue) {
    const run = state.quiz;
    if (!run?.spell || run.cue !== cue || run.closing) return;
    run.closing = true;
    clearInterval(run.timer);
    clearTimeout(run.allInTimer);
    el("btn-skip").hidden = true;
    let results = null;
    try {
      results = await emit("end_spellrace");
    } catch (err) {
      console.warn("autoclass: could not end the spelling race", err);
    }
    finishSpell(cue, results);
  }

  // `ended` is the room's results ({ players, words }), or null for a skipped or failed race.
  function finishSpell(cue, ended) {
    const run = state.quiz;
    if (!run?.spell || run.cue !== cue) return;
    clearInterval(run.timer);
    clearTimeout(run.allInTimer);
    if (!run.closing) emit("end_spellrace").catch(() => {}); // skipped: stop the phones
    state.quiz = null;
    state.cueIndex += 1;
    el("btn-skip").hidden = true;

    const players = ended?.players || [];
    const total = cue.spell.words.length;
    for (const p of players) {
      if (!p.score) continue;
      const entry = state.totals.get(p.id) || { name: p.name, score: 0 };
      entry.name = p.name || entry.name;
      entry.score += p.score;
      state.totals.set(p.id, entry);
    }
    const online = new Set(state.participants.filter((p) => p.online !== false).map((p) => p.userId));
    const results = players
      .filter((p) => p.tried || online.has(p.id))
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        solved: p.solved,
        answerIndex: p.solved >= total ? 0 : p.solved > 0 ? 1 : p.tried ? 2 : null,
        correct: p.solved >= total,
      }));
    const done = results.filter((r) => r.correct).length;
    setLive(results.length ? `${done} of ${results.length} spelled them all` : "", "", true);
    state.pendingResult = ended && results.length && cue.result && window.LangoAutoclassAnalysis
      ? { cue, payload: { results, correctIndex: 0, words: ended.words || [] } }
      : null;
    setTimeout(() => {
      if (state.ended) return;
      video.currentTime = cue.resumeAt ?? cue.at;
      video.play().catch(() => {});
      setTimeout(() => {
        if (!state.quiz) el("live").hidden = true;
      }, 6000);
    }, RESULT_HOLD_MS);
  }

  // ---- Speak: "say it with me". The video has just asked the class to say a sentence; every phone
  // records it at once (Everyone Answers, in practice mode: worker/room-open-answer.js). There are
  // no points and nothing is kept; each phone hears back "great", "almost" or "tried" at once. Those
  // count as option 0, 1 or 2 of a three-option question, so the results page and Tommy's lines
  // (cues.json `speakAnalysis`) work as they do for a quiz.
  //
  // Ask (cue.ask) runs the same round for an open question: a real Everyone Answers round
  // (exercise.autoclass: the room marks each answer with the model, saves no points and does not
  // read the question again). The verdicts (correct, partial, incorrect) are options 0, 1 and 2, and
  // Tommy uses the quiz banks. Marking takes a few seconds, so the results wait for it. ----

  const SPEAK_LATE_MS = 5000; // a recording stopped by the clock still has to be sent and read
  const SPEAK_ALL_IN_MS = 1000; // after the last student has had a go
  const SPEAK_VERDICTS = ["great", "almost", "tried"];
  const SPEAK_OPTIONS = [
    { text: "Great", letter: "🌟" },
    { text: "Almost", letter: "👍" },
    { text: "Good try", letter: "💪" },
  ];
  const ASK_VERDICTS = ["correct", "partial", "incorrect"];
  const ASK_OPTIONS = [
    { text: "Got it", letter: "✅" },
    { text: "Partly", letter: "👍" },
    { text: "Not yet", letter: "💪" },
  ];
  const ASK_MARK_MAX_MS = 20000; // never wait longer than this for the model to mark the answers

  // Every answer is in and marked (practice answers are marked as they arrive).
  const marked = (run) => !run.ask || run.responses.every((r) => r.analysisStatus !== "pending");

  // A warm-up, or a sharing question with no right answer: nobody is marked or scored.
  const unmarked = (cue) => Boolean(cue.ask?.warmup || cue.ask?.open);

  async function runSpeak(cue) {
    const ask = !!cue.ask;
    const seconds = (ask ? cue.ask.seconds : cue.speak.seconds) || (ask ? 30 : 15);
    const prompt = ask ? "Answer on your phone" : "Say it on your phone";
    const run = { cue, speak: true, ask, timer: null, endsAt: 0, clockOffset: 0, closing: false, settled: false, responses: [], finishTimer: null, capTimer: null };
    state.quiz = run;
    clearLost();
    el("btn-skip").textContent = ask ? "Skip question" : "Skip speaking";
    el("btn-skip").hidden = false;
    setLive("Get ready…", "");
    try {
      // A warm-up or sharing question has no marking: the room just counts each go (room-open-answer.js).
      await emit("start_next_exercise", { exercise: unmarked(cue) ? { ...cue.exercise, warmup: true } : cue.exercise });
      await emit("start_openanswer_round");
      const opened = await emit("open_openanswer_window");
      if (state.quiz !== run) return; // skipped meanwhile
      run.clockOffset = Number(opened.serverNow || Date.now()) - Date.now();
      run.endsAt = Number(opened.endsAt) || Date.now() + seconds * 1000;
    } catch (err) {
      console.warn("autoclass: could not start speaking", err);
      setLive(`Could not send it to the phones (${err.message}). Carrying on.`, "");
      setTimeout(() => finishSpeak(cue, false), 2500);
      return;
    }
    setLive(prompt, "");
    const tick = () => {
      const left = Math.max(0, Math.ceil((run.endsAt - (Date.now() + run.clockOffset)) / 1000));
      el("live-timer").textContent = String(left);
      setLiveFill(run.responses.length / Math.max(1, onlineCount(), run.responses.length));
      el("live-text").textContent = !run.closing
        ? `${prompt} · ${run.responses.length} of ${Math.max(onlineCount(), run.responses.length)}`
        : ask
          ? "Thank you! Marking the answers…"
          : "Thank you for speaking!";
      // Never wait on the room's close: if it is lost, the class still goes on.
      if (!left && !run.finishTimer) run.finishTimer = setTimeout(() => finishSpeak(cue, true), (ask ? ASK_MARK_MAX_MS : SPEAK_LATE_MS) + 1500);
    };
    tick();
    run.timer = setInterval(tick, 250);
  }

  // The round on screen, if this frame is about it: a speak round is practice, an ask round is not.
  function openRun(data) {
    const run = state.quiz;
    return run?.speak && !!data.practice === !run.ask ? run : null;
  }

  function onSpeakUpdate(data = {}) {
    const run = openRun(data);
    if (!run || !Array.isArray(data.responses)) return;
    run.responses = data.responses;
    if (unmarked(run.cue)) popNames(run);
    // Late recordings and late marks: once everything is in, there is nothing left to wait for.
    if (run.closing) settleSpeak(run, "");
  }

  // Warm-up: a name pops up on the big screen as each student speaks, in a free spot.
  const NAME_POP_COLS = 4;
  const NAME_POP_ROWS = 3;
  function popNames(run) {
    run.popped ||= new Set();
    run.popSlots ||= [];
    const layer = el("name-pops");
    for (const r of run.responses) {
      if (!r?.playerId || run.popped.has(r.playerId)) continue;
      run.popped.add(r.playerId);
      if (!run.popSlots.length) {
        const all = [];
        for (let row = 0; row < NAME_POP_ROWS; row++) for (let col = 0; col < NAME_POP_COLS; col++) all.push([col, row]);
        run.popSlots = all.sort(() => Math.random() - 0.5);
      }
      const [col, row] = run.popSlots.pop();
      const chip = document.createElement("span");
      chip.className = "name-pop";
      chip.textContent = `👋 ${r.displayName || "Student"}`;
      chip.style.left = `${((col + 0.5) / NAME_POP_COLS) * 100 + (Math.random() - 0.5) * 6}%`;
      chip.style.top = `${((row + 0.5) / NAME_POP_ROWS) * 100 + (Math.random() - 0.5) * 8}%`;
      chip.style.setProperty("--tilt", `${(Math.random() - 0.5) * 8}deg`);
      layer.append(chip);
      const pop = new Audio("/assets/soundeffect/user_click.mp3");
      pop.volume = 0.35;
      pop.play().catch(() => {});
    }
  }

  function onSpeakClosed(data = {}) {
    const run = openRun(data);
    if (!run) return;
    if (Array.isArray(data.responses)) run.responses = data.responses;
    if (unmarked(run.cue)) popNames(run);
    run.closing = true;
    el("btn-skip").hidden = true;
    if (run.ask) run.capTimer = setTimeout(() => finishSpeak(run.cue, true), ASK_MARK_MAX_MS);
    settleSpeak(run, data.closeReason);
  }

  // After the close: wait for any answer still being marked, then for latecomers a little while.
  function settleSpeak(run, closeReason) {
    if (!marked(run)) return;
    if (closeReason === "all" || run.responses.length >= onlineCount()) scheduleSpeakFinish(run, SPEAK_ALL_IN_MS);
    else if (!run.settled) scheduleSpeakFinish(run, SPEAK_LATE_MS);
    run.settled = true;
  }

  function scheduleSpeakFinish(run, ms) {
    clearTimeout(run.finishTimer);
    run.finishTimer = setTimeout(() => finishSpeak(run.cue, true), ms);
  }

  // `heard` is false for a skipped or failed round: no results page then.
  function finishSpeak(cue, heard) {
    const run = state.quiz;
    if (!run?.speak || run.cue !== cue) return;
    clearInterval(run.timer);
    clearTimeout(run.finishTimer);
    clearTimeout(run.capTimer);
    state.quiz = null;
    state.cueIndex += 1;
    el("btn-skip").hidden = true;
    el("name-pops").replaceChildren();

    // Everyone in the class, as a quiz's results are: a student who did not speak is a silent row.
    const byId = new Map(run.responses.map((r) => [r.playerId, r]));
    const people = state.participants.filter((p) => p.online !== false).map((p) => ({ playerId: p.userId, name: p.displayName || p.name }));
    for (const r of run.responses) if (!people.some((p) => p.playerId === r.playerId)) people.push({ playerId: r.playerId, name: r.displayName });
    // An answer the model could not mark (in time) still counts as a go: "good try" / "not yet".
    const results = people.map(({ playerId, name }) => {
      const answer = byId.get(playerId);
      const index = run.ask ? ASK_VERDICTS.indexOf(answer?.answerVerdict) : SPEAK_VERDICTS.indexOf(answer?.practiceVerdict);
      return { playerId, name, answerIndex: index < 0 ? (answer ? 2 : null) : index, correct: index === 0 };
    });
    const spoke = results.filter((r) => r.answerIndex !== null).length;
    setLive(results.length && heard ? `${spoke} of ${results.length} had a go` : "", "", true);
    // The phones keep showing each student's "great speaking!" while Tommy says the sentence again,
    // and go back to "watch" when the results page opens (runResult).
    // A warm-up has no marks to show: only the answers Tommy reads out, so nobody spoke, no page.
    const warm = Boolean(run.ask && unmarked(cue));
    state.pendingResult = heard && results.length && cue.result && window.LangoAutoclassAnalysis && (!warm || spoke)
      ? { cue, payload: { results, correctIndex: 0 }, watchLater: true }
      : null;
    if (run.closing === false) emit("close_openanswer_window").catch(() => {}); // skipped: stop the phones recording
    if (run.ask && state.pendingResult && spoke) askHighlights(cue);
    if (!state.pendingResult) phonesToWatch();
    setTimeout(() => {
      if (state.ended) return;
      video.currentTime = cue.resumeAt ?? cue.at;
      video.play().catch(() => {});
      setTimeout(() => {
        if (!state.quiz) el("live").hidden = true;
      }, 6000);
    }, RESULT_HOLD_MS);
  }

  // ---- Best answers: after an open question (cue.ask), the room has a model pick a few of the
  // class's answers and write Uncle Tommy's line about each, by name (worker/room-highlights.js).
  // It is asked for as soon as the answers are in, so it is usually ready by the time Tommy has
  // given the answer; the results page reads them out after its usual lines, and waits a little for
  // them at most. Nothing picked, or too slow: the class just carries on. ----

  const HIGHLIGHTS_WAIT_MS = 12000;

  function askHighlights(cue) {
    let resolve;
    const ready = new Promise((r) => (resolve = r));
    state.highlights = { cue, picks: null, ready, resolve };
    const tutor = state.lesson?.tutor || {};
    emit("openanswer_highlights", {
      question: cue.ask.question,
      lesson: { title: state.lesson?.title || "", audience: tutor.audience || "", language: tutor.language || "en" },
    })
      .then((res) => {
        if (res?.pending === false) onHighlights({ picks: res.picks || [] });
      })
      .catch(() => onHighlights({ picks: [] }));
  }

  function onHighlights(data) {
    const h = state.highlights;
    if (!h || h.picks) return;
    h.picks = Array.isArray(data?.picks) ? data.picks.filter((p) => p?.quote && p?.say) : [];
    h.resolve();
  }

  // ---- Cheer: on the page of students who got it right, Uncle Tommy also thanks a few of them by
  // name (worker/room-cheer.js). Asked for when the results open, so it is ready by page 2. No
  // names, no voice or too slow: the page just carries on without it. ----

  const CHEER_WAIT_MS = 6000;

  function askCheer(payload) {
    const names = (payload.results || [])
      .filter((r) => r && r.correct && r.name)
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .map((r) => String(r.name))
      .slice(0, 3);
    let resolve;
    const ready = new Promise((r) => (resolve = r));
    state.cheer = { ready, resolve, data: null };
    if (!names.length) return resolve();
    emit("result_cheer", { names, lesson: { language: state.lesson?.tutor?.language || "en" } })
      .then((res) => {
        if (res?.pending === false) resolve();
      })
      .catch(() => resolve());
  }

  function onCheer(data) {
    const c = state.cheer;
    if (!c || c.data) return;
    c.data = data?.say ? data : null;
    c.resolve();
  }

  async function sayCheer(run) {
    const c = state.cheer;
    state.cheer = null;
    if (!c) return;
    await Promise.race([c.ready, wait(run, CHEER_WAIT_MS)]);
    if (!c.data) return;
    await sayLine(run, { text: c.data.say, url: c.data.audioContent ? `data:audio/mpeg;base64,${c.data.audioContent}` : "" });
  }

  async function sayHighlights(run, cue) {
    const h = state.highlights;
    if (!h || h.cue !== cue) return;
    state.highlights = null;
    await Promise.race([h.ready, wait(run, HIGHLIGHTS_WAIT_MS)]);
    const caption = el("result-caption");
    for (const pick of h.picks || []) {
      caption.classList.add("is-swapping");
      await wait(run, 200);
      caption.textContent = `💬 ${pick.name ? `${pick.name}：` : ""}「${pick.quote}」`;
      caption.classList.remove("is-swapping");
      await wait(run, 900); // time to read whose answer it is
      const started = Date.now();
      setTommyMood(run.speakMood || "happy");
      if (pick.audioContent) await playClip(run, `data:audio/mpeg;base64,${pick.audioContent}`);
      setTommyMood("neutral");
      const left = Math.max(2500, pick.say.length * 120) - (Date.now() - started);
      if (!pick.audioContent && left > 0) await wait(run, left);
      await wait(run, 500);
    }
  }

  // ---- Tutor: a student raises a hand and asks Uncle Tommy a question out loud. The worker makes
  // the answer (worker/room-tutor.js); this page decides WHEN to play it. It never cuts in: it waits
  // for one of the quiet moments in the cues file (`tutor.breaks`: Tommy has just finished a line
  // in a teaching scene), says a short lead-in, shows the question, plays the answer, says a
  // lead-out and plays on. The card grows out of the small Tommy in the video and goes back into
  // him, so the screen never jumps. ----

  const TUTOR_WINDOW_S = 0.6; // a break is used if the video is this close after it
  const TUTOR_MAX_S = 75; // an answer never holds the class longer than this
  const ABORT = Symbol("tutor aborted");
  let tutorBusy = false; // from the card opening until it has fully gone

  function tutorConfig() {
    const tutor = state.lesson?.tutor;
    return tutor?.enabled ? tutor : null;
  }

  // The phones show the hand button only while Tommy can still take questions: the class gets
  // at most `maxAnswers`, counting the ones already waiting.
  async function syncAsking() {
    const tutor = tutorConfig();
    if (!tutor || !state.socket) return;
    const want = state.answered + state.hands.size < tutor.maxAnswers;
    if (want === state.asking) return;
    state.asking = want;
    await emit("set_tutor", {
      enabled: want,
      lesson: { title: state.lesson.title, outline: tutor.outline, audience: tutor.audience || "", language: tutor.language, sttLanguage: tutor.sttLanguage },
    }).catch((err) => {
      state.asking = !want;
      console.warn("autoclass: questions", err);
    });
  }

  function renderHands() {
    const count = state.hands.size;
    el("hands").hidden = !count;
    if (!count) return;
    const [first] = state.hands.values();
    el("hands-text").textContent = count === 1 ? `${first.name || "A student"} has a question` : `${count} students have questions`;
  }

  function onAskReceived({ id, name } = {}) {
    if (!id) return;
    state.hands.set(id, { name });
    renderHands();
    void syncAsking();
  }

  function onTutorAnswer(data = {}) {
    const entry = state.hands.get(data.id);
    if (!entry || !data.answer) return;
    state.answers.push({ ...data, name: data.name || entry.name });
  }

  function onTutorDeclined({ id } = {}) {
    state.hands.delete(id);
    renderHands();
    void syncAsking();
  }

  // True when the video has just reached a quiet moment in a teaching scene (Tommy has finished a
  // line) and an answer is ready to play. The answer never cuts in mid-sentence: it also plays when the
  // page pauses for a question (Tommy has just asked it) and when a results page closes, whichever
  // comes first. See answerWaiting().
  function takeBreak() {
    const tutor = tutorConfig();
    if (!tutor || state.quiz || state.ended || video.paused || !state.answers.length) return null;
    const now = video.currentTime;
    const index = tutor.breaks.findIndex((at, i) => !state.usedBreaks.has(i) && now >= at && now < at + TUTOR_WINDOW_S);
    if (index < 0) return null;
    state.usedBreaks.add(index);
    return tutor.breaks[index];
  }

  // An answer is ready and nothing is holding the class: play it at this scene change.
  function answerWaiting() {
    return Boolean(tutorConfig() && state.answers.length && !tutorBusy && !state.ended);
  }

  function wait(run, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      run.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).then(() => {
      if (run.aborted) throw ABORT;
    });
  }

  // Plays one of Tommy's recorded lines, or an answer's audio, and resolves when it ends.
  // `onTime(progress)` follows it; a missing or broken file just resolves.
  function playClip(run, url, onTime) {
    if (!url) return Promise.resolve();
    return new Promise((resolve) => {
      const audio = new Audio(url);
      run.audio = audio;
      const end = () => resolve();
      audio.addEventListener("ended", end, { once: true });
      audio.addEventListener("error", end, { once: true });
      if (onTime) audio.addEventListener("timeupdate", () => audio.duration && onTime(audio.currentTime / audio.duration));
      run.wake = end;
      audio.play().catch(end);
    }).then(() => {
      run.audio = null;
      if (run.aborted) throw ABORT;
    });
  }

  const pick = (list) => list?.[Math.floor(Math.random() * list.length)];

  // Cantonese has no spaces, so it lights up in short runs of characters.
  function answerWords(text) {
    const parts = /\s/.test(text) ? text.split(/(\s+)/) : text.match(/.{1,3}/gu) || [];
    return parts.map((part) => (/^\s+$/.test(part) ? part : `<span class="w">${escapeText(part)}</span>`)).join("");
  }

  function lightUp(progress) {
    const words = el("tutor-answer").querySelectorAll(".w");
    const lit = Math.ceil(progress * words.length * 1.02);
    words.forEach((word, i) => word.classList.toggle("on", i < lit));
  }

  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  async function runTutor() {
    const tutor = tutorConfig();
    const item = state.answers.shift();
    if (!tutor || !item) return;
    tutorBusy = true;
    const run = { tutor: true, aborted: false, audio: null, wake: null };
    state.quiz = run; // like a question or a poll, this holds the video
    const limit = setTimeout(skipTutor, TUTOR_MAX_S * 1000);
    clearLost();
    el("live").hidden = true; // the card owns the bottom right
    el("hands").hidden = true;
    el("btn-skip").textContent = "Skip answer";
    el("btn-skip").hidden = false;

    const layer = el("tutor");
    const a = tutor.anchor;
    layer.style.setProperty("--ar", `${(1920 - a.x - a.w) / 19.2}cqw`);
    layer.style.setProperty("--ab", `${(1080 - a.y - a.h) / 19.2}cqw`);
    layer.style.setProperty("--aw", `${a.w / 19.2}cqw`);
    layer.style.setProperty("--ah", `${a.h / 19.2}cqw`);
    const tommy = el("tutor-tommy");
    if (!tommy.src) tommy.src = tutor.tommyVideo;
    el("tutor-name").textContent = item.name ? `${item.name} asks` : "A question";
    el("tutor-question").textContent = item.question ? `“${item.question}”` : "";
    el("tutor-answer").innerHTML = answerWords(item.answer);

    try {
      // Same size, place and colour as the small Tommy, with the live one on top of him.
      video.pause();
      layer.classList.remove("is-open", "is-text", "is-fading");
      layer.hidden = false;
      tommy.currentTime = 0;
      tommy.play().catch(() => {});
      await frame();
      layer.classList.add("is-open");
      const leadIn = playClip(run, pick(tutor.leadIns));
      leadIn.catch(() => {}); // an abort during the next wait is handled there
      await wait(run, 450);
      layer.classList.add("is-text");
      await leadIn;
      // Tommy says the question again, so the whole room hears what was asked.
      if (item.questionAudioContent) await playClip(run, `data:audio/mpeg;base64,${item.questionAudioContent}`);
      await wait(run, 700); // time to read the question
      if (item.audioContent) {
        await playClip(run, `data:audio/mpeg;base64,${item.audioContent}`, lightUp);
      } else {
        // The voice failed: the words still light up, at reading speed.
        const words = el("tutor-answer").querySelectorAll(".w").length;
        for (let i = 1; i <= words; i += 1) {
          lightUp(i / words);
          await wait(run, 380);
        }
        await wait(run, 1500);
      }
      lightUp(1);
      await wait(run, 500);
      await playClip(run, pick(tutor.leadOuts));
    } catch (error) {
      if (error !== ABORT) console.warn("autoclass: could not answer", error);
    }
    clearTimeout(limit);
    try {
      await closeTutor(run, layer, tommy, item);
    } catch (error) {
      console.warn("autoclass: could not close the answer card cleanly", error);
    } finally {
      // Whatever went wrong, the card goes and the class carries on.
      tutorBusy = false;
      hideTutor();
      if (state.quiz === run) {
        state.quiz = null;
        state.hands.delete(item.id);
        renderHands();
        el("btn-skip").hidden = true;
        if (!state.ended) video.play().catch(() => {});
      }
    }
  }

  function hideTutor() {
    el("tutor").hidden = true;
    el("tutor-tommy").pause();
  }

  async function closeTutor(run, layer, tommy, item) {
    run.closing = true;
    run.aborted = false; // the closing steps always play out
    run.audio?.pause();
    layer.classList.remove("is-text");
    await wait(run, 250);
    layer.classList.remove("is-open");
    await wait(run, 650);
    // Back at the small Tommy's size: the video starts again and the card fades into him.
    layer.classList.add("is-fading");
    state.quiz = null;
    state.answered += 1;
    state.hands.delete(item.id);
    renderHands();
    el("btn-skip").hidden = true;
    if (!state.ended) video.play().catch(() => {});
    void syncAsking();
    await wait(run, 350);
  }

  function skipTutor() {
    const run = state.quiz;
    if ((!run?.tutor && !run?.result) || run.closing) return;
    run.aborted = true;
    run.audio?.pause();
    run.wake?.();
  }

  // ---- Results: after a question's scene has revealed the answer, the page pauses once more and
  // shows how the class answered, while Uncle Tommy says a few things about it. His lines are all
  // recorded when the lesson is built (cues.json `analysis`, many per situation) and
  // public/autoclass-analysis.js only picks which to play, so there is no waiting and nothing is
  // made up in class. The page fades in over the paused video and out again before it plays on. ----

  const RESULT_MAX_S = 60; // like an answer, the results never hold the class longer than this
  const extra0 = (names) => (names.length > RESULT_NAMES_MAX ? RESULT_NAMES_MAX - 1 : RESULT_NAMES_MAX);
  const RESULT_NAMES_MAX = 15; // the board fills the screen's left side: five across, three down
  let resultBusy = false;

  // Emoji are a distraction while the class is watching, so the phones' emoji bar is open only
  // while the results page is up: the class has just answered and has something to react to.
  // ("I don't get it" stays on all through the lesson.)
  let emojiOpen = false;
  function setEmojiOpen(open) {
    if (open === emojiOpen || !state.socket) return;
    emojiOpen = open;
    emit("set_emoji", { open }).catch(() => {
      emojiOpen = !open;
    });
  }

  // True once the video reaches the pause point of the question that was just answered. If it is
  // long past (the class was rewound or skipped on), the results are dropped instead of shown late.
  function resultDue() {
    const pending = state.pendingResult;
    if (!pending || state.quiz || state.ended || video.paused) return false;
    const at = pending.cue.result.at;
    if (video.currentTime > at + 2) {
      if (pending.watchLater) phonesToWatch();
      state.pendingResult = null;
      return false;
    }
    return video.currentTime >= at;
  }

  function setAnchor(element, tutor) {
    const a = tutor?.anchor || { x: 1600, y: 735, w: 276, h: 324 };
    element.style.setProperty("--ar", `${(1920 - a.x - a.w) / 19.2}cqw`);
    element.style.setProperty("--ab", `${(1080 - a.y - a.h) / 19.2}cqw`);
    element.style.setProperty("--aw", `${a.w / 19.2}cqw`);
    element.style.setProperty("--ah", `${a.h / 19.2}cqw`);
  }

  function resultOptions(cue) {
    if (cue.speak) return SPEAK_OPTIONS;
    if (cue.ask) return ASK_OPTIONS;
    if (cue.spell) return SPELL_OPTIONS;
    return cue.exercise.items[0].options;
  }

  const RESULT_SILENT_COLOR = "#cfc8da";

  function t(key, vars, fallback) {
    const text = typeof uiT === "function" ? uiT(key, vars) : key;
    return text === key ? fallback : text;
  }

  function initialsOf(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => [...part][0]?.toUpperCase() || "").join("") || "?";
  }

  // Laid out like the host's quiz results: the question and its answer, then a donut of how the
  // class answered, and the students who got it right.
  function renderResult(cue, payload, summary) {
    const item = cue.exercise.items?.[0];
    const speak = !!cue.speak;
    const ask = !!cue.ask;
    const spell = !!cue.spell;
    const colors = typeof LANGO_MCQ_OPTION_COLORS !== "undefined" ? LANGO_MCQ_OPTION_COLORS : ["#E838A8", "#FFE566", "#5C3A9E", "#45E0E8"];
    el("result-tag").textContent = speak ? "Speaking results" : spell ? "Spelling race" : t("mcq.resultsTitle", null, "Results");
    el("result-question").textContent = speak
      ? `“${cue.speak.sentence}”`
      : ask
        ? cue.ask.question
        : spell
          ? cue.spell.words.map((w) => `${w.emoji} ${w.word}`).join("  ·  ")
          : item.title;
    el("result-summary").textContent = !summary.total
      ? ""
      : speak
        ? `${summary.answered} / ${summary.total} had a go`
        : `${summary.right} / ${summary.total} ${spell ? "🏆" : "✓"}`;

    const options = resultOptions(cue);
    const letterOf = (option, index) => (speak || ask || spell ? option.letter : `${option.letter || String.fromCharCode(65 + index)}.`);
    const right = options[payload.correctIndex];
    const correct = el("result-correct");
    correct.hidden = speak || !right;
    const hardest = spell ? hardestWord(payload) : null;
    if (spell) {
      // The word the class found hardest is worth a look; if everyone got every word, nothing is.
      correct.hidden = !hardest;
      if (hardest) {
        el("result-correct-text").innerHTML = `Hardest word: <span class="result-correct-highlight">${escapeText(`${hardest.emoji || ""} ${hardest.word}`.trim())}</span>`;
      }
    } else if (ask) {
      el("result-correct-text").innerHTML = `${escapeText(t("mcq.correctAnswer", null, "Correct Answer:"))} <span class="result-correct-highlight">${escapeText(cue.ask.answer)}</span>`;
    } else if (!speak && right) {
      el("result-correct-text").innerHTML = `${escapeText(t("mcq.correctAnswer", null, "Correct Answer:"))} <span class="result-correct-letter">${escapeText(letterOf(right, payload.correctIndex))}</span> <span class="result-correct-highlight">${escapeText(right.text)}</span>`;
    }

    const rows = options.map((option, index) => ({
      letter: letterOf(option, index),
      text: option.text,
      count: summary.counts[index] || 0,
      color: colors[index % colors.length],
      right: !speak && index === payload.correctIndex,
    }));
    // Students who did not answer are a grey slice of their own: it is not a wrong answer.
    if (summary.silent > 0) rows.push({ letter: "–", text: "No answer", count: summary.silent, color: RESULT_SILENT_COLOR, silent: true });

    const whole = Math.max(rows.reduce((sum, row) => sum + row.count, 0), 1);
    let offset = 0;
    const stops = rows.map((row) => {
      const start = offset;
      offset += (row.count / whole) * 100;
      return `${row.color} ${start}% ${offset}%`;
    });
    const donut = el("result-donut");
    donut.style.setProperty("--donut-fill", offset ? stops.join(", ") : `${RESULT_SILENT_COLOR} 0% 100%`);
    el("result-donut-label").textContent = t("mcq.totalResponses", null, "Total Responses");
    el("result-total").textContent = String(summary.answered);
    el("result-distribution-title").textContent = t("mcq.answerDistribution", null, "Answer Distribution");
    const countLabel = (n) => (n === 1 ? t("mcq.responseCountOne", { n }, `${n} Response`) : t("mcq.responseCount", { n }, `${n} Responses`));
    el("result-legend").innerHTML = rows
      .map((row, i) => `<li class="result-legend-item${row.right ? " is-right" : ""}${row.silent ? " is-silent" : ""}" style="--i: ${i}">
        <span class="result-legend-dot" style="--dot-color: ${row.color}"></span>
        <span class="result-legend-letter">${escapeText(row.letter)}</span>
        <span class="result-legend-copy">${escapeText(row.text)}</span>
        <strong>${escapeText(countLabel(row.count))}</strong></li>`)
      .join("");

    // Only the ones who got it right are named: nobody is named for a mistake or a silence. A race
    // names its top spellers, most words first, with how many each spelled.
    const names = spell
      ? (payload.results || [])
        .filter((r) => r && r.solved > 0 && r.name)
        .sort((a, b) => b.solved - a.solved)
        .map((r) => ({ name: String(r.name), label: `${r.name} · ${r.solved}` }))
      : (payload.results || []).filter((r) => r && r.correct && r.name).map((r) => ({ name: String(r.name), label: String(r.name) }));
    const got = el("result-got");
    got.hidden = !names.length;
    const count = el("result-got-count");
    count.hidden = !summary.total;
    count.textContent = `${speak ? summary.answered : summary.right} / ${summary.total}`;
    if (names.length) {
      el("result-got-title").textContent = speak ? "🌟 Great speaking" : spell ? "🏆 Top spellers" : t("mcq.correctResponses", null, "Correct Responses");
      const shown = names.slice(0, extra0(names));
      const extra = names.length - shown.length;
      const cells = shown.length + (extra ? 1 : 0);
      el("result-got-grid").style.setProperty("--cols", String(Math.min(cells, 5)));
      el("result-got-grid").innerHTML =
        shown
          .map(({ name, label }, i) => `<div class="result-got-student" style="--i: ${i}" title="${escapeText(label)}">
            <span class="result-got-avatar">${escapeText(initialsOf(name))}</span><span class="result-got-name">${escapeText(label)}</span></div>`)
          .join("") +
        (extra ? `<div class="result-got-student" style="--i: ${shown.length}"><span class="result-got-avatar is-more">+${extra}</span></div>` : "");
    }
    el("result-caption").textContent = "";
  }

  // The word fewest students spelled (most wrong tries breaks a tie), or null when everyone who
  // took part spelled every word.
  function hardestWord(payload) {
    const tried = (payload.results || []).filter((r) => r.answerIndex !== null).length;
    const words = (payload.words || []).filter((w) => w.right < tried || w.misses > 0);
    if (!tried || !words.length) return null;
    return words.reduce((worst, w) => (w.right < worst.right || (w.right === worst.right && w.misses > worst.misses) ? w : worst));
  }

  // ---- Tommy's moods on the results page: calm while he waits, happy while he talks, and cheering
  // (arms wide) when he celebrates a good result. Each is a short loop (public/assets/tommy/),
  // made from the Lottie animations the team supplied. ----

  const TOMMY_MOODS = {
    neutral: "/assets/tommy/tommy-neutral.webm",
    happy: "/assets/tommy/tommy-happy.webm",
    excited: "/assets/tommy/tommy-excited.webm",
  };
  const moodVideos = [];

  function preloadTommyMoods() {
    if (moodVideos.length) return;
    for (const src of Object.values(TOMMY_MOODS)) {
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.src = src;
      moodVideos.push(v);
    }
  }

  function setTommyMood(mood) {
    const v = el("result-tommy");
    const src = TOMMY_MOODS[mood];
    if (!src) return;
    if (!v.src.endsWith(src)) v.src = src;
    v.play().catch(() => {});
  }

  async function sayLine(run, line) {
    const caption = el("result-caption");
    caption.classList.add("is-swapping");
    await wait(run, 200);
    caption.textContent = line.text;
    caption.classList.remove("is-swapping");
    const started = Date.now();
    setTommyMood(run.speakMood || "happy");
    await playClip(run, line.url);
    setTommyMood("neutral");
    // If the recording is missing the words still stay long enough to read.
    const left = Math.max(1800, line.text.length * 55) - (Date.now() - started);
    if (left > 0) await wait(run, left);
    await wait(run, 250);
  }

  // ---- Results sound: when the answers come in, a short sound that matches how the class did.
  // A fanfare when everyone got it, a bright chime when most did, and something warm and
  // rising when it was hard: never a buzzer, so a wrong answer never feels like a telling-off.
  // The chimes are made here (Web Audio); the fanfare, the ding and the applause are sound files. ----

  const RESULT_SOUND_FILES = {
    fanfare: { src: "/assets/soundeffect/login_success.mp3", volume: 0.4 },
    ding: { src: "/assets/soundeffect/user_correct_answer.mp3", volume: 0.55 },
    // Applause made with earshot (MIT): big, medium and soft. They are equally loud in the files,
    // so the volume sets how big the room sounds.
    applauseBig: { src: "/assets/soundeffect/applause-big.mp3", volume: 0.7 },
    applauseMid: { src: "/assets/soundeffect/applause-mid.mp3", volume: 0.55 },
    applauseSoft: { src: "/assets/soundeffect/applause-soft.mp3", volume: 0.4 },
  };
  // Notes (Hz) and when each starts (s): a bright run up, a softer two-note lift, a warm rise.
  const RESULT_CHIMES = {
    sparkle: [[784, 0], [988, 0.09], [1175, 0.18], [1568, 0.27]],
    lift: [[523, 0], [659, 0.16], [784, 0.32]],
    warm: [[392, 0], [494, 0.22], [587, 0.44], [784, 0.7]],
  };
  const RESULT_SOUNDS = {
    allRight: ["fanfare", "sparkle", "applauseBig"],
    singleRight: ["fanfare", "sparkle", "applauseBig"],
    mostRight: ["ding", "lift", "applauseMid"],
    mixed: ["lift", "applauseSoft"],
    mostWrong: ["warm", "applauseSoft"],
    noneRight: ["warm"],
    singleWrong: ["warm"],
    warmup: ["sparkle", "applauseMid"],
    everyoneIn: ["fanfare", "ding", "sparkle", "applauseSoft"],
  };
  let resultAudioContext = null;

  function playResultSound(situation) {
    for (const name of RESULT_SOUNDS[situation] || []) {
      if (RESULT_SOUND_FILES[name]) {
        const { src, volume } = RESULT_SOUND_FILES[name];
        const audio = new Audio(src);
        audio.volume = volume;
        audio.play().catch(() => {});
      } else if (RESULT_CHIMES[name]) {
        playChime(RESULT_CHIMES[name]);
      }
    }
  }

  // One answer came in: a short bright pop that climbs as more students answer. When the last one
  // is in: a ding and a run of bells.
  function playAnswerSound(answered, total, before = 0) {
    if (answered >= total) {
      playResultSound("everyoneIn");
      return;
    }
    const base = 620 + 640 * (answered / total);
    playChime([[base, 0], [base * 1.5, 0.06]], { decay: 0.35, level: 1.4 });
    // Crossing half way: a quick "level up" run of notes on top of the pop.
    if (before / total < 0.5 && answered / total >= 0.5) {
      playChime([[523, 0.1], [659, 0.18], [784, 0.26], [1047, 0.34]], { decay: 0.5, level: 1.2 });
    }
  }

  function playChime(notes, { decay = 1.1, level = 1 } = {}) {
    try {
      resultAudioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = resultAudioContext;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const start = ctx.currentTime + 0.05;
      for (const [freq, at] of notes) {
        // A soft bell: a sine with a little of its octave, a quick attack and a long fade.
        for (const [mult, amp] of [[1, 0.18 * level], [2, 0.05 * level]]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq * mult;
          gain.gain.setValueAtTime(0, start + at);
          gain.gain.linearRampToValueAtTime(amp, start + at + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + at + decay);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start + at);
          osc.stop(start + at + decay + 0.1);
        }
      }
    } catch {
      /* no Web Audio: the results just show */
    }
  }

  async function runResult() {
    const { cue, payload, watchLater } = state.pendingResult;
    state.pendingResult = null;
    if (watchLater) phonesToWatch();
    const tutor = tutorConfig();
    const run = { result: true, aborted: false, audio: null, wake: null, cue };
    state.quiz = run; // like a question, this holds the video
    resultBusy = true;
    const limit = setTimeout(skipTutor, (cue.ask ? RESULT_MAX_S + 45 : RESULT_MAX_S) * 1000 /* an open question also reads out the best answers */);
    clearLost();
    el("live").hidden = true;
    el("hands").hidden = true;
    el("btn-skip").textContent = "Skip results";
    el("btn-skip").hidden = false;

    const layer = el("result");
    const tommy = el("result-tommy");
    let lines = [];

    const warm = unmarked(cue);
    try {
      video.pause();
      // If this loop was late the video has run a little into the next scene: go back to the answer.
      if (video.currentTime > cue.result.at) video.currentTime = cue.result.at;
      // A warm-up shows only the answers Tommy reads out by name; with none picked it just plays on.
      if (warm) {
        const h = state.highlights;
        if (h?.cue === cue) await Promise.race([h.ready, wait(run, HIGHLIGHTS_WAIT_MS)]);
        if (!h || h.cue !== cue || !h.picks?.length) {
          state.highlights = null;
          throw ABORT;
        }
      }
      const options = resultOptions(cue);
      const analysis = window.LangoAutoclassAnalysis;
      const summary = analysis.summarize(payload.results, options.length, payload.correctIndex);
      // Speaking has its own lines: nothing there may sound like a mistake.
      const banks = (cue.speak ? state.lesson.speakAnalysis : state.lesson.analysis) || {};
      lines = state.picker && !warm
        ? analysis.plan(summary, banks, cue.result.wrong || {}, state.picker, { questionKey: cue.result.key }).lines
        : [];
      renderResult(cue, payload, summary);
      if (warm) el("result-tag").textContent = `${cue.ask.open ? "💬" : "👋"} ${cue.ask.tag || (cue.ask.open ? "Share" : "Warm-up")}`;
      setAnchor(layer, tutor);
      setTommyMood("neutral");
      layer.classList.remove("is-open", "is-revealed", "is-step-2");
      layer.classList.toggle("is-warmup", warm);
      // Students who got it right get a page of their own, after the question and the donut.
      const board = !warm && !el("result-got").hidden;
      if (board) askCheer(payload);
      layer.classList.toggle("is-step-1", board);
      layer.hidden = false;
      tommy.hidden = false;
      tommy.currentTime = 0;
      tommy.play().catch(() => {});
      await frame();
      layer.classList.add("is-open");
      setEmojiOpen(true);
      await wait(run, 450);
      // The donut sweeps round and the answers come in one after another.
      layer.classList.add("is-revealed");
      if (!board) playResultSound(warm ? "warmup" : summary.situation);
      await wait(run, 1100);
      if (!board) {
        for (const line of lines) await sayLine(run, line);
        if (cue.ask) await sayHighlights(run, cue);
        if (!lines.length && !warm) await wait(run, 5000); // no recordings: the bars alone, for a few seconds
      } else {
        // Page 1: how the class answered. Tommy leads in and talks about the wrong answers or the
        // silent friends; the line about how the class did waits for the students on page 2.
        const cheer = lines.find((line) => line.kind === summary.situation);
        const first = lines.filter((line) => line !== cheer);
        for (const line of first) await sayLine(run, line);
        if (!first.length) await wait(run, 4000);
        await wait(run, 500);
        // Page 2: the question fades out, the students who got it right fill the screen.
        el("result-caption").textContent = "";
        layer.classList.remove("is-step-1");
        layer.classList.add("is-step-2");
        // A good result is cheered with arms wide; otherwise he stays warm.
        run.speakMood = ["allRight", "singleRight", "mostRight"].includes(summary.situation) ? "excited" : "happy";
        setTommyMood(run.speakMood);
        playResultSound(summary.situation);
        await wait(run, 1300);
        if (cheer) await sayLine(run, cheer);
        await sayCheer(run);
        if (cue.ask) await sayHighlights(run, cue);
        if (!cheer) await wait(run, 3500);
        await wait(run, 2200); // time to find your own name
      }
      await wait(run, 600);
    } catch (error) {
      if (error !== ABORT) console.warn("autoclass: could not show the results", error);
    }
    clearTimeout(limit);
    run.closing = true;
    run.aborted = false; // the closing steps always play out
    run.audio?.pause();
    setEmojiOpen(false);
    try {
      layer.classList.remove("is-open");
      await wait(run, 450);
    } catch {
      /* closing never stops half way */
    } finally {
      resultBusy = false;
      hideResult();
      if (state.quiz === run) {
        state.quiz = null;
        el("btn-skip").hidden = true;
        // A scene change: a waiting answer plays now, then the lesson goes on.
        if (!state.ended) {
          if (answerWaiting()) void runTutor();
          else video.play().catch(() => {});
        }
      }
    }
  }

  function hideResult() {
    el("result").hidden = true;
    el("result-tommy").pause();
  }

  // ---- Emoji reactions: each one floats up from the bottom of the frame and fades. ----

  const MAX_FLOATING = 40;
  let floating = 0;
  let reactionSeq = 0;

  function showReaction({ emoji, name } = {}) {
    if (!emoji || floating >= MAX_FLOATING || el("stage").hidden) return;
    floating += 1;
    reactionSeq += 1;
    const item = document.createElement("div");
    item.className = "reaction-float";
    // Spread along the right edge so it stays clear of the question, the bars and the live strip text.
    const lane = (reactionSeq * 37) % 100;
    item.style.left = `${76 + lane * 0.18}%`;
    item.style.setProperty("--drift", `${((reactionSeq * 53) % 7) - 3}cqw`);
    item.innerHTML = `<span class="reaction-emoji">${escapeText(emoji)}</span>${name ? `<span class="reaction-name">${escapeText(name)}</span>` : ""}`;
    item.addEventListener("animationend", () => {
      item.remove();
      floating -= 1;
    }, { once: true });
    el("reactions").appendChild(item);
  }

  // ---- "I don't get it": how many students pressed it lately, and a replay of that part. ----

  const LOST_WINDOW_MS = 20000; // one press counts this long (join-reactions.js LOST_HOLD_MS)
  const REPLAY_LEAD_S = 10; // students press a little after they got lost
  const lost = new Map(); // playerId -> when their press stops counting
  let lostSince = 0; // video time of the first press in this batch
  let lostTicker = null;

  function onLost({ playerId } = {}) {
    if (!playerId || state.quiz || state.ended || video.ended || el("stage").hidden) return;
    if (!lost.size) lostSince = video.currentTime;
    lost.set(playerId, Date.now() + LOST_WINDOW_MS);
    renderLost();
  }

  function renderLost() {
    const now = Date.now();
    for (const [playerId, until] of lost) if (until <= now) lost.delete(playerId);
    const count = lost.size;
    el("lost").hidden = !count;
    if (count) {
      el("lost-text").textContent = count === 1 ? "1 student doesn't get this part" : `${count} students don't get this part`;
      if (!lostTicker) lostTicker = setInterval(renderLost, 1000);
    } else {
      clearInterval(lostTicker);
      lostTicker = null;
    }
  }

  function clearLost() {
    lost.clear();
    renderLost();
  }

  // Go back to a little before the first press, but never past the last question.
  function replayLostPart() {
    if (state.quiz || state.ended || !lost.size) return;
    const lastCue = state.lesson.cues[state.cueIndex - 1];
    const floor = lastCue ? lastCue.resumeAt ?? lastCue.at : 0;
    video.currentTime = Math.max(floor, lostSince - REPLAY_LEAD_S);
    clearLost();
    video.play().catch(() => {});
  }

  // `fill` (0 to 1) is how far the strip's bar is filled: the answers in so far.
  function setLive(text, timer, isResult = false, fill = 0) {
    const live = el("live");
    live.hidden = !text;
    live.classList.toggle("is-result", !!isResult);
    setLiveFill(fill);
    el("live-text").textContent = text;
    el("live-timer").textContent = timer;
    document.querySelector(".live-phone").hidden = !!isResult;
  }

  function setLiveFill(fill) {
    const live = el("live");
    const share = Math.max(0, Math.min(1, Number(fill) || 0));
    live.style.setProperty("--fill", `${Math.round(share * 100)}%`);
    live.dataset.level = share >= 1 ? "full" : share >= 0.5 ? "mid" : "low";
  }

  async function onVideoEnded() {
    if (state.ended) return;
    try {
      await emit("end_room_exercise", { exerciseId: WATCH_EXERCISE().id, exerciseType: "video" });
    } catch {
      /* the board still shows */
    }
    showFinalBoard();
  }

  function fitFinalBoard() {
    el("final").style.setProperty("--final-scale", String(el("frame").clientWidth / 1280));
  }
  window.addEventListener("resize", fitFinalBoard);

  // The host's own end-of-round leaderboard: podium for the top three, a sheet for the rest.
  // ---- Room card: the QR code and room code in the top right while the class runs. ----

  const ROOMCARD_FOLD_KEY = "lango_autoclass_roomcard_folded";

  function setRoomCardFolded(folded) {
    const card = el("roomcard");
    card.classList.toggle("is-collapsed", folded);
    card.setAttribute("aria-expanded", folded ? "false" : "true");
  }

  function showRoomCard() {
    let folded = false;
    try {
      folded = localStorage.getItem(ROOMCARD_FOLD_KEY) === "1";
    } catch {
      /* private mode */
    }
    setRoomCardFolded(folded);
    el("roomcard").hidden = false;
  }

  function toggleRoomCard() {
    const folded = !el("roomcard").classList.contains("is-collapsed");
    setRoomCardFolded(folded);
    try {
      localStorage.setItem(ROOMCARD_FOLD_KEY, folded ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function showFinalBoard() {
    // Inside the demo page (autoclass-demo.html): tell it the class is over, so it can count down to the next.
    if (window.parent !== window) window.parent.postMessage({ type: "autoclass-ended", lesson: LESSON }, location.origin);
    el("roomcard").hidden = true;
    const rows = [...state.totals.entries()].map(([id, r]) => ({ id, name: r.name, score: r.score }));
    const board = el("final");
    board.hidden = false;
    fitFinalBoard();
    el("live").hidden = true;
    clearLost();
    el("final-cheer").textContent = t("leaderboard.tommyCheer", null, "Great work, class!");
    showExerciseLeaderboards({
      exerciseLeaderboard: rows,
      semesterLeaderboard: [],
      exerciseListEl: el("final-list"),
      semesterListEl: el("final-list-overall"),
      exerciseWrapEl: el("final-board"),
      semesterWrapEl: el("final-board-overall"),
    });
    if (el("host-leaderboard-title").textContent === "leaderboard.exerciseResults") {
      el("host-leaderboard-title").textContent = "Class complete!";
    }
  }

  async function endClass() {
    if (!confirm("End this class for everyone?")) return;
    state.ended = true;
    setEmojiOpen(false);
    skipTutor();
    video.pause();
    try {
      await api("/api/session/end", { method: "POST", body: { roomId: state.roomId, class: state.classItem, user: state.user } });
    } catch {
      /* the room may already be gone */
    }
    state.socket?.disconnect();
    showFinalBoard();
    el("btn-end").hidden = true;
    el("btn-pause").hidden = true;
  }

  function togglePause() {
    if (state.quiz) return; // a question is already holding the video
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  video.addEventListener("play", () => (el("btn-pause").textContent = "Pause"));
  video.addEventListener("pause", () => (el("btn-pause").textContent = "Play"));
  video.addEventListener("ended", onVideoEnded);
  el("open-room").addEventListener("click", openRoom);
  el("start-class").addEventListener("click", startClass);
  el("btn-pause").addEventListener("click", togglePause);
  el("btn-skip").addEventListener("click", () => {
    if (state.quiz?.tutor || state.quiz?.result) skipTutor();
    else if (state.quiz?.poll) finishPoll(state.quiz.cue);
    else if (state.quiz?.spell) finishSpell(state.quiz.cue, null);
    else if (state.quiz?.speak) finishSpeak(state.quiz.cue, false);
    else finishCue(null);
  });
  el("btn-end").addEventListener("click", endClass);
  el("btn-music").addEventListener("click", toggleMusic);
  el("roomcard").addEventListener("click", toggleRoomCard);
  el("lobby-music").addEventListener("click", toggleMusic);
  el("scene-music").addEventListener("click", toggleMusic);

  init();
})();
