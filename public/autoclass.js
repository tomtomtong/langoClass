// Autoclass (internal test): a class that runs itself from one lesson video.
//
// The lesson is a HyperFrames render plus a cues file, both made by the render container from a
// saved lesson script (docs/autoclass-step2-plan.md) and loaded by id: ?lesson=<id> reads
// /api/autoclass/lessons/<id>/cues, the render the lesson last published:
//   { "video": "...mp4", "cues": [{ "at": 37, "exercise": { id, type: "mcquiz", title, items } }] }
// A cue can be a poll instead of a question: { "at": 59, "poll": { id, question, options, seconds } }.
// Or "say it with me": { "at": 48, "speak": { sentence, seconds }, "exercise": { type: "openanswer", practice: true } }
// (see "Speak" below).
// The video does not show a poll; this page draws it over the paused video (see "Poll" below).
// The video shows each question itself and pauses on it at `at`. This page sends that quiz to
// the phones with the same room events host.html uses (start_next_exercise, create_room_game,
// start_room_game, next_question), waits for the results, then plays on into the reveal.
// Between questions the phones show the usual "watch the big screen" screen (a video exercise).
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const LESSON = params.get("lesson") || "animal-homes";
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
    picker: window.LangoAutoclassAnalysis ? window.LangoAutoclassAnalysis.makePicker() : null,
  };

  function showError(message) {
    el("setup-error").textContent = message || "";
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
      setLive("Get ready…", "");
      state.socket.emit("question_tts_done", { questionIndex: data?.questionIndex });
    });
    socket.on("question_start", onQuestionStart);
    socket.on("question_results", onQuestionResults);
    socket.on("reaction", showReaction);
    socket.on("lost", onLost);
    socket.on("poll_votes", onPollVotes);
    socket.on("ask_received", onAskReceived);
    socket.on("tutor_answer", onTutorAnswer);
    socket.on("tutor_declined", onTutorDeclined);
    socket.on("openanswer_update", onSpeakUpdate);
    socket.on("openanswer_closed", onSpeakClosed);
    socket.io?.on?.("reconnect", () => emit("host_session", { uiLocale: "en" }).catch(() => {}));

    return new Promise((resolve, reject) => {
      socket.once("connect", () => {
        emit("host_session", { uiLocale: "en" })
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
    el("joined-names").textContent = online.map((p) => p.displayName || p.name).join(", ") || "nobody yet";
  }

  // ---- Setup ----

  async function init() {
    try {
      const res = await fetch(CUES_URL, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `No lesson "${LESSON}".`);
      }
      state.lesson = await res.json();
      const polls = state.lesson.cues.filter((cue) => cue.poll).length;
      const speaks = state.lesson.cues.filter((cue) => cue.speak).length;
      el("setup-lesson").textContent =
        `Lesson: ${state.lesson.title} · ${state.lesson.cues.length - polls - speaks} questions` +
        (speaks ? ` · ${speaks} speaking` : "") +
        (polls ? ` · ${polls} poll${polls > 1 ? "s" : ""}` : "");
      void loadVideo(state.lesson.video);
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
      el("class-step").hidden = true;
      el("room-step").hidden = false;
    } catch (err) {
      showError(err.message);
      button.disabled = false;
    }
  }

  // ---- Running the class ----

  const WATCH_EXERCISE = () => ({
    id: `autoclass-watch-${LESSON}`,
    type: "video",
    title: state.lesson?.title || "Watch the big screen",
    items: [],
  });

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
    state.cueIndex = 0;
    video.currentTime = 0;
    await video.play().catch(() => {});
    requestAnimationFrame(watchForCue);
  }

  // timeupdate fires only ~4 times a second; a frame loop stops within one frame of the cue.
  function watchForCue() {
    if (state.ended) return;
    const cue = state.lesson.cues[state.cueIndex];
    // A question's results come before whatever cue follows it, even if this loop was slow to notice
    // (a window in the background runs it only about once a second).
    if (resultDue()) {
      void runResult();
    } else if (cue && !state.quiz && !video.paused && video.currentTime >= cue.at) {
      video.pause();
      video.currentTime = cue.at;
      void runCue(cue);
    } else {
      const quietAt = takeBreak();
      if (quietAt !== null) void runTutor();
    }
    if (!tutorBusy && !el("tutor").hidden) hideTutor(); // the card can never be left on screen
    if (!resultBusy && !el("result").hidden) hideResult(); // nor the results page
    requestAnimationFrame(watchForCue);
  }

  async function runCue(cue) {
    if (cue.poll) return runPoll(cue);
    if (cue.speak || cue.ask) return runSpeak(cue);
    const quiz = mcQuizPayloadFromExercise(cue.exercise);
    state.quiz = { cue, endsAt: 0, clockOffset: 0, timer: null };
    clearLost();
    el("btn-skip").textContent = "Skip question";
    el("btn-skip").hidden = false;
    setLive("Get ready…", "");
    try {
      await emit("start_next_exercise", { exercise: cue.exercise });
      await emit("create_room_game", { quiz });
      await emit("start_room_game");
    } catch (err) {
      console.warn("autoclass: could not start the quiz", err);
      setLive(`Could not send the question (${err.message}). Carrying on.`, "");
      setTimeout(() => finishCue(null), 2500);
    }
  }

  function onQuestionStart(data) {
    if (!state.quiz) return;
    state.quiz.clockOffset = Number(data.serverNow || Date.now()) - Date.now();
    state.quiz.endsAt = Number(data.endsAt) || Date.now() + (data.timeLimit || 15) * 1000;
    setLive("Answers are open", "");
    clearInterval(state.quiz.timer);
    const tick = () => {
      const left = Math.max(0, Math.ceil((state.quiz.endsAt - (Date.now() + state.quiz.clockOffset)) / 1000));
      el("live-timer").textContent = String(left);
    };
    tick();
    state.quiz.timer = setInterval(tick, 250);
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
    const right = results.filter((r) => r.correct).length;
    if (results.length) {
      setLive(`${right} of ${results.length} got it right${answered < results.length ? ` · ${results.length - answered} no answer` : ""}`, "", true);
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
      await emit("start_next_exercise", { exercise: cue.exercise });
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
    // Late recordings and late marks: once everything is in, there is nothing left to wait for.
    if (run.closing) settleSpeak(run, "");
  }

  function onSpeakClosed(data = {}) {
    const run = openRun(data);
    if (!run) return;
    if (Array.isArray(data.responses)) run.responses = data.responses;
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
    state.pendingResult = heard && results.length && cue.result && window.LangoAutoclassAnalysis
      ? { cue, payload: { results, correctIndex: 0 }, watchLater: true }
      : null;
    if (run.closing === false) emit("close_openanswer_window").catch(() => {}); // skipped: stop the phones recording
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

  // True when the video has just reached a quiet moment and an answer is ready to play.
  function takeBreak() {
    const tutor = tutorConfig();
    if (!tutor || state.quiz || state.ended || video.paused || !state.answers.length) return null;
    const now = video.currentTime;
    const index = tutor.breaks.findIndex((at, i) => !state.usedBreaks.has(i) && now >= at && now < at + TUTOR_WINDOW_S);
    if (index < 0) return null;
    state.usedBreaks.add(index);
    return tutor.breaks[index];
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
  const RESULT_NAMES_MAX = 6;
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
    const item = cue.exercise.items[0];
    const speak = !!cue.speak;
    const ask = !!cue.ask;
    const colors = typeof LANGO_MCQ_OPTION_COLORS !== "undefined" ? LANGO_MCQ_OPTION_COLORS : ["#E838A8", "#FFE566", "#5C3A9E", "#45E0E8"];
    el("result-tag").textContent = speak ? "Speaking results" : t("mcq.resultsTitle", null, "Results");
    el("result-question").textContent = speak ? `“${cue.speak.sentence}”` : ask ? cue.ask.question : item.title;
    el("result-summary").textContent = !summary.total
      ? ""
      : speak
        ? `${summary.answered} / ${summary.total} had a go`
        : `${summary.right} / ${summary.total} ✓`;

    const options = resultOptions(cue);
    const letterOf = (option, index) => (speak || ask ? option.letter : `${option.letter || String.fromCharCode(65 + index)}.`);
    const right = options[payload.correctIndex];
    const correct = el("result-correct");
    correct.hidden = speak || !right;
    if (ask) {
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

    // Only the ones who got it right are named: nobody is named for a mistake or a silence.
    const names = (payload.results || []).filter((r) => r && r.correct && r.name).map((r) => String(r.name));
    const got = el("result-got");
    got.hidden = !names.length;
    if (names.length) {
      el("result-got-title").textContent = speak ? "🌟 Great speaking" : t("mcq.correctResponses", null, "Correct Responses");
      const shown = names.slice(0, RESULT_NAMES_MAX);
      const extra = names.length - shown.length;
      el("result-got-grid").innerHTML =
        shown
          .map((name, i) => `<div class="result-got-student" style="--i: ${i}" title="${escapeText(name)}">
            <span class="result-got-avatar">${escapeText(initialsOf(name))}</span><span class="result-got-name">${escapeText(name)}</span></div>`)
          .join("") +
        (extra ? `<div class="result-got-student" style="--i: ${shown.length}"><span class="result-got-avatar is-more">+${extra}</span></div>` : "");
    }
    el("result-caption").textContent = "";
  }

  async function sayLine(run, line) {
    const caption = el("result-caption");
    caption.classList.add("is-swapping");
    await wait(run, 200);
    caption.textContent = line.text;
    caption.classList.remove("is-swapping");
    const started = Date.now();
    await playClip(run, line.url);
    // If the recording is missing the words still stay long enough to read.
    const left = Math.max(1800, line.text.length * 55) - (Date.now() - started);
    if (left > 0) await wait(run, left);
    await wait(run, 250);
  }

  async function runResult() {
    const { cue, payload, watchLater } = state.pendingResult;
    state.pendingResult = null;
    if (watchLater) phonesToWatch();
    const tutor = tutorConfig();
    const run = { result: true, aborted: false, audio: null, wake: null, cue };
    state.quiz = run; // like a question, this holds the video
    resultBusy = true;
    const limit = setTimeout(skipTutor, RESULT_MAX_S * 1000);
    clearLost();
    el("live").hidden = true;
    el("hands").hidden = true;
    el("btn-skip").textContent = "Skip results";
    el("btn-skip").hidden = false;

    const layer = el("result");
    const tommy = el("result-tommy");
    let lines = [];

    try {
      video.pause();
      // If this loop was late the video has run a little into the next scene: go back to the answer.
      if (video.currentTime > cue.result.at) video.currentTime = cue.result.at;
      const options = resultOptions(cue);
      const analysis = window.LangoAutoclassAnalysis;
      const summary = analysis.summarize(payload.results, options.length, payload.correctIndex);
      // Speaking has its own lines: nothing there may sound like a mistake.
      const banks = (cue.speak ? state.lesson.speakAnalysis : state.lesson.analysis) || {};
      lines = state.picker
        ? analysis.plan(summary, banks, cue.result.wrong || {}, state.picker, { questionKey: cue.result.key }).lines
        : [];
      renderResult(cue, payload, summary);
      setAnchor(layer, tutor);
      if (tutor?.tommyVideo && !tommy.src) tommy.src = tutor.tommyVideo;
      layer.classList.remove("is-open", "is-revealed");
      layer.hidden = false;
      tommy.hidden = !tutor?.tommyVideo;
      tommy.currentTime = 0;
      tommy.play().catch(() => {});
      await frame();
      layer.classList.add("is-open");
      setEmojiOpen(true);
      await wait(run, 450);
      // The donut sweeps round and the answers come in one after another.
      layer.classList.add("is-revealed");
      await wait(run, 1100);
      for (const line of lines) await sayLine(run, line);
      if (!lines.length) await wait(run, 5000); // no recordings: the bars alone, for a few seconds
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
        if (!state.ended) video.play().catch(() => {});
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

  function setLive(text, timer, isResult = false) {
    const live = el("live");
    live.hidden = !text;
    live.classList.toggle("is-result", !!isResult);
    el("live-text").textContent = text;
    el("live-timer").textContent = timer;
    document.querySelector(".live-phone").hidden = !!isResult;
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
  function showFinalBoard() {
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
    else if (state.quiz?.speak) finishSpeak(state.quiz.cue, false);
    else finishCue(null);
  });
  el("btn-end").addEventListener("click", endClass);
  el("lost").addEventListener("click", replayLostPart);

  init();
})();
