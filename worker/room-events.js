import {
  awardBuzz,
  exerciseKind,
  queueBuzzScores,
  queueOpenScores,
  queueQuizScores,
  queueVideoScores,
} from "./room-scores.js";

const PREVIEW_MS = 5000;
const BUZZ_JOIN_MS = 20000;
const NORMAL_POINTS = 300;
const FAST_POINTS = 500;
const HOST_GRACE_MS = 60 * 1000;

export function applyRoomEvent(state, message, ctx) {
  const event = message?.event;
  const data = message?.data || {};
  if (!state?.session && event !== "ping") {
    return done(state, { ack: { ok: false, error: "Room not found." } });
  }
  switch (event) {
    case "host_session":
      return hostSession(state, data, ctx);
    case "set_session_locale":
      return setLocale(state, data, ctx);
    case "join_session":
      return joinSession(state, data, ctx);
    case "start_session":
      return startSession(state, ctx);
    case "select_session_exercise":
      return selectExercise(state, data, ctx);
    case "start_next_exercise":
      return startNextExercise(state, data, ctx);
    case "create_room_game":
      return createRoomGame(state, data, ctx);
    case "join_room_game":
      return joinRoomGame(state, data, ctx);
    case "start_room_game":
    case "start_game":
      return startRoomGame(state, ctx);
    case "submit_answer":
      return submitAnswer(state, data, ctx);
    case "next_question":
      return nextQuestion(state, ctx);
    case "question_tts_done":
      return openFromSpeaking(state, data, ctx);
    case "end_room_exercise":
      return endExercise(state, data, ctx);
    case "start_buzzin_round":
      return startBuzz(state, ctx);
    case "next_buzzin_question":
      return nextBuzz(state, ctx);
    case "open_buzzin_join":
      return openBuzz(state, ctx);
    case "buzz_in":
      return buzzIn(state, ctx);
    case "get_buzzin_state":
      return getBuzz(state, ctx);
    case "buzzin_lucky_draw":
      return luckyDraw(state, ctx);
    case "submit_buzzin_response":
      return submitBuzzResponse(state, data, ctx);
    default:
      return done(state, { ack: { ok: false, error: `Unknown event: ${event || "message"}` } });
  }
}

export function applyRoomTimer(state, now) {
  const timer = state?.timer;
  if (!timer) return done(state, { clearTimer: true });
  if (now + 250 < timer.at) return done(state, { timer });
  if (timer.kind === "preview") return openQuestion(state, now);
  if (timer.kind === "question") return finishQuestion(state, now);
  if (timer.kind === "game-start") return beginQuestion(state, now);
  if (timer.kind === "buzz") return closeBuzz(state, now);
  if (timer.kind === "host-grace") return expireHostGrace(state, now);
  return done(state, { clearTimer: true });
}

export function markSocketClosed(state, ctx) {
  if (!state?.session) return done(state);
  const socketId = ctx.socketId;
  const meta = state.sockets?.[socketId] || null;
  if (state.sockets) delete state.sockets[socketId];
  const participant = (state.session.participants || []).find((item) => item.socketId === socketId);
  if (participant) {
    participant.online = false;
    participant.offlineSince = ctx.now;
  }
  const wasHost = meta?.role === "host" || state.session.hostSocketId === socketId;
  if (wasHost && state.session.hostSocketId === socketId) state.session.hostSocketId = null;
  if (wasHost && !hasHostSocket(state)) return beginHostGrace(state, ctx.now);
  return done(state, { broadcasts: [lobby(state)] });
}

function hostSession(state, data, ctx) {
  if (!ctx.socketId) return done(state, { ack: { ok: false, error: "Missing connection." } });
  if (state.session.status === "ended") {
    return done(state, { ack: { ok: false, error: "This class session has ended." } });
  }
  state.session.hostSocketId = ctx.socketId;
  if (data.uiLocale) state.session.uiLocale = clip(data.uiLocale, 16) || "en";
  rememberSocket(state, ctx.socketId, { role: "host", playerId: null });
  const ack = {
    ok: true,
    roomId: state.session.roomId,
    status: state.session.status,
    participants: participantPayload(state),
    uiLocale: state.session.uiLocale || "en",
  };
  const attachment = { role: "host", playerId: null };
  const broadcasts = [lobby(state), localeEvent(state)];
  if (state.timer?.kind !== "host-grace") return done(state, { attachment, ack, broadcasts });
  return resumeAfterHostGrace(state, ctx.now, { attachment, ack, broadcasts });
}

function setLocale(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can change the class language." } });
  state.session.uiLocale = clip(data.uiLocale, 16) || "en";
  return done(state, {
    ack: { ok: true, roomId: state.session.roomId, uiLocale: state.session.uiLocale },
    broadcasts: [localeEvent(state), lobby(state)],
  });
}

function joinSession(state, data, ctx) {
  if (state.session.status === "ended") {
    return done(state, { ack: { ok: false, errorCode: "session_ended", error: "This class session has ended." } });
  }
  let playerId = clip(String(data.userId || "").replace(/[^a-zA-Z0-9_-]/g, ""), 64);
  if (!playerId) playerId = `web_${ctx.now}_${ctx.socketId.slice(0, 8)}`;
  const name = participantName(state, data, playerId);
  if (!name) {
    return done(state, { ack: { ok: false, error: "Could not identify this student. Check your join link or ask your teacher." } });
  }
  const taken = (state.session.participants || []).some(
    (item) => item.userId !== playerId && String(item.displayName || "").toLowerCase() === name.toLowerCase()
  );
  if (taken) return done(state, { ack: { ok: false, error: "Name already taken in this class." } });

  const existing = (state.session.participants || []).find((item) => item.userId === playerId);
  if (existing) {
    existing.displayName = name;
    existing.socketId = ctx.socketId;
    existing.online = true;
    existing.offlineSince = null;
  } else {
    state.session.participants.push({
      userId: playerId,
      displayName: name,
      socketId: ctx.socketId,
      online: true,
      offlineSince: null,
      isReady: false,
      joinedAt: ctx.now,
    });
  }
  rememberSocket(state, ctx.socketId, { role: "session_player", playerId });
  syncGamePlayers(state);
  const direct = [];
  if (state.session.status === "start") direct.push({ event: "session_started", data: preload(state) });
  else if (state.session.exercise) direct.push({ event: "session_media_preload", data: preload(state) });
  return done(state, {
    attachment: { role: "session_player", playerId },
    ack: {
      ok: true,
      roomId: state.session.roomId,
      userId: playerId,
      displayName: name,
      sessionStatus: state.session.status,
      uiLocale: state.session.uiLocale || "en",
      ...preload(state),
    },
    broadcasts: [lobby(state)],
    direct,
  });
}

function startSession(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can start the class." } });
  if (!state.session.exercise?.id) {
    return done(state, { ack: { ok: false, error: "Select an exercise before starting the class." } });
  }
  const alreadyStarted = state.session.status === "start";
  if (!alreadyStarted) {
    state.session.status = "start";
    state.session.startedAt = ctx.now;
  }
  return done(state, {
    ack: { ok: true, roomId: state.session.roomId, status: "start", alreadyStarted },
    broadcasts: [{ event: "session_started", data: preload(state) }, lobby(state)],
  });
}

function selectExercise(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can select an exercise." } });
  if (!data.exercise?.id) return done(state, { ack: { ok: false, error: "Select a valid exercise." } });
  state.session.exercise = data.exercise;
  if (data.course?.id) {
    state.session.courseId = data.course.id;
    state.session.courseName = clip(data.course.name || data.course.title, 200);
  }
  return done(state, {
    ack: { ok: true, roomId: state.session.roomId, status: state.session.status, exercise: state.session.exercise },
    broadcasts: [{ event: "session_media_preload", data: preload(state) }],
  });
}

function startNextExercise(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can start the next exercise." } });
  if (!data.exercise?.id) return done(state, { ack: { ok: false, error: "Select a valid exercise." } });
  queueOpenScores(state, ctx.now);
  state.session.exercise = data.exercise;
  state.session.status = "start";
  state.game = null;
  state.buzz = null;
  return done(state, {
    ack: { ok: true, roomId: state.session.roomId },
    broadcasts: [
      { event: "room_quiz_cleared", data: {} },
      { event: "session_started", data: preload(state) },
      lobby(state),
    ],
    clearTimer: true,
  });
}

function createRoomGame(state, data, ctx) {
  const quiz = normalizeQuiz(data.quiz);
  if (!quiz.questions.length) return done(state, { ack: { ok: false, error: "Invalid room or quiz." } });
  state.game = {
    pin: state.session.roomId,
    status: "lobby",
    quiz,
    isRoomGame: true,
    fastMode: quiz.fastMode,
    exercise: exerciseLabel(state.session.exercise),
    courseId: state.session.courseId ?? null,
    players: (state.session.participants || []).map((item) => ({
      id: item.userId,
      name: item.displayName,
      score: 0,
      correctAnswers: 0,
      participated: false,
    })),
    currentQuestionIndex: -1,
    questionStartedAt: null,
    previewEndsAt: null,
    answers: {},
    answerHistory: [],
    lastQuestionResults: null,
  };
  rememberSocket(state, ctx.socketId, { role: "host", playerId: null });
  return done(state, {
    attachment: { role: "host", playerId: null },
    ack: { ok: true, roomId: state.session.roomId, quizTitle: quiz.title, questionCount: quiz.questions.length },
    broadcasts: [gameLobby(state)],
    clearTimer: true,
  });
}

function joinRoomGame(state, data, ctx) {
  const game = state.game;
  if (!game?.isRoomGame) return done(state, { ack: { ok: false, error: "Class quiz not started yet. Wait for your teacher." } });
  if (game.status === "finished") return done(state, { ack: { ok: false, error: "Class quiz has ended." } });
  const playerId = clip(String(data.userId || ctx.playerId || "").replace(/[^a-zA-Z0-9_-]/g, ""), 64);
  if (!playerId) return done(state, { ack: { ok: false, error: "Rejoin the class waiting room first." } });
  const participant = (state.session.participants || []).find((item) => item.userId === playerId);
  if (!participant) return done(state, { ack: { ok: false, error: "Join the class waiting room before the quiz starts." } });
  const name = participant.displayName;
  let player = game.players.find((item) => item.id === playerId);
  if (!player) {
    player = { id: playerId, name, score: 0, correctAnswers: 0, participated: true };
    game.players.push(player);
  } else {
    player.name = name;
    player.participated = true;
  }
  rememberSocket(state, ctx.socketId, { role: "player", playerId });
  const direct = currentQuestionEvents(state);
  return done(state, {
    attachment: { role: "player", playerId },
    ack: { ok: true, roomId: game.pin, quizTitle: game.quiz.title, playerId, fastMode: !!game.fastMode },
    broadcasts: [gameLobby(state)],
    direct,
  });
}

function startRoomGame(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can start the quiz." } });
  if (!state.game || state.game.status !== "lobby") return done(state, { ack: { ok: false, error: "Quiz is not ready." } });
  state.game.status = "starting";
  const delay = state.game.fastMode ? 2000 : 0;
  const starting = {
    event: "game_starting",
    data: { totalQuestions: state.game.quiz.questions.length, fastMode: !!state.game.fastMode },
  };
  if (delay <= 0) {
    const next = beginQuestion(state, ctx.now);
    next.broadcasts = [starting, ...next.broadcasts];
    next.ack = { ok: true };
    return next;
  }
  return done(state, {
    ack: { ok: true },
    broadcasts: [starting],
    timer: { kind: "game-start", at: ctx.now + delay },
  });
}

function submitAnswer(state, data, ctx) {
  const game = state.game;
  const playerId = ctx.playerId;
  if (!playerId || !game || game.status !== "question") return done(state);
  if (game.answers[playerId]) return done(state);
  syncGamePlayers(state);
  const player = game.players.find((item) => item.id === playerId);
  if (player) player.participated = true;
  const question = game.quiz.questions[game.currentQuestionIndex];
  const idx = Number(data.answerIndex);
  const optionCount = question?.options?.length || 0;
  if (!Number.isInteger(idx) || idx < 0 || idx >= optionCount) return done(state);
  game.answers[playerId] = { answerIndex: idx, timeMs: Math.max(0, ctx.now - (game.questionStartedAt || ctx.now)) };
  const everyone = game.players.length > 0 && Object.keys(game.answers).length >= game.players.length;
  if (!everyone) {
    return done(state, { direct: [{ event: "answer_received", data: {} }] });
  }
  const finished = finishQuestion(state, ctx.now);
  finished.direct = [{ event: "answer_received", data: {} }, ...(finished.direct || [])];
  return finished;
}

function nextQuestion(state, ctx) {
  if (!isHost(ctx) || state.game?.status !== "results") return done(state);
  return beginQuestion(state, ctx.now);
}

function openFromSpeaking(state, data, ctx) {
  if (!isHost(ctx) || state.game?.status !== "speaking") return done(state);
  if (Number(data.questionIndex) !== state.game.currentQuestionIndex) return done(state);
  return openQuestion(state, ctx.now);
}

function endExercise(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can end an exercise." } });
  const finished = finishedExercise(state, data);
  const kind = exerciseKind(finished);
  if (kind === "quiz" && state.game) queueQuizScores(state, ctx.now);
  else if (kind === "video") queueVideoScores(state, finished, ctx.now);
  else if (kind === "buzzin") queueBuzzScores(state, finished, ctx.now);
  const leaderboard = state.game ? leaderboardOf(state.game) : [];
  state.game = null;
  state.buzz = null;
  state.session.status = "waiting";
  state.session.startedAt = null;
  return done(state, {
    ack: { ok: true, exerciseLeaderboard: leaderboard, semesterLeaderboard: [] },
    broadcasts: [
      { event: "room_quiz_cleared", data: {} },
      { event: "room_exercise_wrap_up", data: { exerciseLeaderboard: leaderboard, semesterLeaderboard: [] } },
      lobby(state),
    ],
    clearTimer: true,
  });
}

function startBuzz(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can start a buzz-in round." } });
  const topics = buzzTopics(state.session.exercise);
  if (!topics.length) return done(state, { ack: { ok: false, error: "This Buzz In exercise has no questions." } });
  const exerciseId = state.session.exercise?.id ?? null;
  if (state.session.buzzinExerciseId == null || String(state.session.buzzinExerciseId) !== String(exerciseId)) {
    state.session.buzzinExerciseId = exerciseId;
    state.session.buzzinAwardedPlayers = [];
  }
  state.buzz = newBuzz(topics, 0, ctx.now);
  const payload = buzzPayload(state.buzz, ctx.now);
  return done(state, {
    ack: { ok: true, ...payload },
    broadcasts: [{ event: "buzzin_round_started", data: payload }],
    clearTimer: true,
  });
}

function nextBuzz(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can advance Buzz In questions." } });
  if (!state.buzz) return done(state, { ack: { ok: false, error: "Buzz-in round not prepared." } });
  const topics = state.buzz.topics || [];
  const nextIndex = state.buzz.questionIndex + 1;
  if (nextIndex >= topics.length) return done(state, { ack: { ok: false, error: "No more Buzz In questions." } });
  state.buzz = newBuzz(topics, nextIndex, ctx.now);
  const payload = buzzPayload(state.buzz, ctx.now);
  return done(state, {
    ack: { ok: true, ...payload },
    broadcasts: [{ event: "buzzin_round_started", data: payload }],
    clearTimer: true,
  });
}

function openBuzz(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can open the buzz-in window." } });
  const round = state.buzz;
  if (!round) return done(state, { ack: { ok: false, error: "Buzz-in round not prepared." } });
  if (round.phase !== "ready") return done(state, { ack: { ok: false, error: "Buzz in already started." } });
  round.phase = "join";
  round.status = "open";
  round.joinOpenedAt = ctx.now;
  round.joinEndsAt = ctx.now + BUZZ_JOIN_MS;
  const payload = buzzPayload(round, ctx.now);
  return done(state, {
    ack: { ok: true, ...payload },
    broadcasts: [{ event: "buzzin_join_opened", data: payload }],
    timer: { kind: "buzz", at: round.joinEndsAt },
  });
}

function buzzIn(state, ctx) {
  const playerId = ctx.playerId;
  if (!playerId || (ctx.role !== "session_player" && ctx.role !== "player")) {
    return done(state, { ack: { ok: false, error: "Join the class waiting room first." } });
  }
  const round = state.buzz;
  if (!round || round.phase !== "join" || round.status !== "open") {
    return done(state, { ack: { ok: false, error: "Buzz in is closed." } });
  }
  if (ctx.now >= round.joinEndsAt) return done(state, { ack: { ok: false, error: "Buzz in time is up." } });
  if (round.buzzes.some((item) => item.playerId === playerId)) {
    return done(state, { ack: { ok: false, error: "You already buzzed in." } });
  }
  if (round.buzzes.length >= 1) return done(state, { ack: { ok: false, error: "Someone already buzzed in." } });
  const participant = (state.session.participants || []).find((item) => item.userId === playerId);
  const rank = round.buzzes.length + 1;
  round.buzzes.push({
    playerId,
    displayName: participant?.displayName || "Student",
    rank,
    at: ctx.now,
    elapsedMs: Math.max(0, ctx.now - (round.joinOpenedAt || ctx.now)),
  });
  awardBuzz(state, playerId, participant?.displayName);
  round.phase = "typing";
  round.status = "closed";
  const payload = buzzPayload(round, ctx.now);
  return done(state, {
    ack: { ok: true, rank, selected: true, roundId: round.roundId },
    broadcasts: [{ event: "buzzin_join_closed", data: payload }, { event: "buzzin_update", data: payload }],
    clearTimer: true,
  });
}

function getBuzz(state, ctx) {
  if (!state.buzz) return done(state, { ack: { ok: true, active: false } });
  return done(state, { ack: { ok: true, active: true, ...buzzPayload(state.buzz, ctx.now) } });
}

function luckyDraw(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can run a lucky draw." } });
  const round = state.buzz;
  if (!round) return done(state, { ack: { ok: false, error: "Buzz-in round not prepared." } });
  const answered = new Set(round.buzzes.map((item) => item.playerId));
  const pool = (state.session.participants || []).filter((item) => item.online !== false && !answered.has(item.userId));
  if (!pool.length) return done(state, { ack: { ok: false, error: "No students left to draw." } });
  const pick = pool[ctx.pick(pool.length) % pool.length];
  round.buzzes = [{
    playerId: pick.userId,
    displayName: pick.displayName,
    rank: 1,
    at: ctx.now,
    elapsedMs: 0,
  }];
  awardBuzz(state, pick.userId, pick.displayName);
  round.phase = "typing";
  round.status = "closed";
  const payload = buzzPayload(round, ctx.now);
  return done(state, {
    ack: { ok: true, ...payload },
    broadcasts: [{ event: "buzzin_join_closed", data: payload }],
    clearTimer: true,
  });
}

function submitBuzzResponse(state, data, ctx) {
  const round = state.buzz;
  const playerId = ctx.playerId;
  if (!round || !playerId) return done(state, { ack: { ok: false, error: "Buzz in is closed." } });
  const text = clip(data.text, 500);
  if (!text) {
    return done(state, { ack: { ok: false, error: "Record your answer before submitting." } });
  }
  round.responses = round.responses.filter((item) => item.playerId !== playerId);
  round.responses.push({ playerId, text, analysisStatus: "done", analysis: "" });
  round.phase = "done";
  const payload = buzzPayload(round, ctx.now);
  return done(state, {
    ack: { ok: true, ...payload },
    broadcasts: [{ event: "buzzin_response_analyzed", data: payload }],
  });
}

function beginQuestion(state, now) {
  const game = state.game;
  if (!game) return done(state, { clearTimer: true });
  const nextIndex = game.currentQuestionIndex + 1;
  if (nextIndex >= game.quiz.questions.length) {
    game.status = "finished";
    queueQuizScores(state, now);
    const exerciseLeaderboard = leaderboardOf(game);
    return done(state, {
      broadcasts: [{
        event: "game_finished",
        data: {
          leaderboard: exerciseLeaderboard,
          accuracyLeaderboard: accuracyOf(game),
          answerReview: game.quiz.questions.map((question, questionIndex) => ({
            questionIndex,
            text: question.text,
            options: question.options,
            correctIndex: question.correctIndex,
          })),
          answerHistory: game.answerHistory,
          exerciseLeaderboard,
          semesterLeaderboard: [],
        },
      }],
      clearTimer: true,
    });
  }
  game.currentQuestionIndex = nextIndex;
  game.answers = {};
  game.questionStartedAt = null;
  game.previewEndsAt = null;
  if (game.fastMode) return openQuestion(state, now);
  game.status = "preview";
  game.previewEndsAt = now + PREVIEW_MS;
  const question = game.quiz.questions[nextIndex];
  return done(state, {
    broadcasts: [{
      event: "question_preview",
      data: {
        questionIndex: nextIndex,
        totalQuestions: game.quiz.questions.length,
        text: question.text,
        previewSeconds: PREVIEW_MS / 1000,
        previewEndsAt: game.previewEndsAt,
        points: pointsOf(game),
        image: question.image || null,
        fastMode: false,
      },
    }],
    timer: { kind: "preview", at: game.previewEndsAt },
  });
}

function openQuestion(state, now) {
  const game = state.game;
  const question = game?.quiz?.questions?.[game.currentQuestionIndex];
  if (!game || !question) return done(state, { clearTimer: true });
  syncGamePlayers(state);
  const timeLimit = (question.timeLimit || 15) * 1000;
  game.status = "question";
  game.questionStartedAt = now;
  game.previewEndsAt = null;
  return done(state, {
    broadcasts: [{
      event: "question_start",
      data: {
        questionIndex: game.currentQuestionIndex,
        totalQuestions: game.quiz.questions.length,
        text: question.text,
        options: question.options,
        timeLimit: question.timeLimit || 15,
        endsAt: now + timeLimit,
        points: pointsOf(game),
        image: question.image || null,
        fastMode: !!game.fastMode,
      },
    }],
    timer: { kind: "question", at: now + timeLimit },
  });
}

function finishQuestion(state, now) {
  const game = state.game;
  if (!game || game.status !== "question") return done(state, { clearTimer: true });
  const question = game.quiz.questions[game.currentQuestionIndex];
  const optionCount = question?.options?.length || 0;
  const answerCounts = Array.from({ length: optionCount }, () => 0);
  const results = [];
  for (const player of game.players) {
    const answer = game.answers[player.id];
    if (!answer) {
      results.push({ playerId: player.id, name: player.name, correct: false, points: 0, answerIndex: null });
      continue;
    }
    if (answer.answerIndex >= 0 && answer.answerIndex < optionCount) answerCounts[answer.answerIndex] += 1;
    const correct = answer.answerIndex === question.correctIndex;
    const points = correct ? pointsOf(game) : 0;
    if (correct) {
      player.score += points;
      player.correctAnswers = (player.correctAnswers || 0) + 1;
    }
    results.push({ playerId: player.id, name: player.name, correct, points, answerIndex: answer.answerIndex });
  }
  if (game.fastMode) {
    game.answerHistory[game.currentQuestionIndex] = results.map((item) => ({
      playerId: item.playerId,
      answerIndex: item.answerIndex,
      correct: item.correct,
    }));
    game.status = "between";
    const isLast = game.currentQuestionIndex + 1 >= game.quiz.questions.length;
    return done(state, {
      broadcasts: [{
        event: "question_between",
        data: { questionIndex: game.currentQuestionIndex, totalQuestions: game.quiz.questions.length, isLast },
      }],
      timer: { kind: "game-start", at: now + 1500 },
    });
  }
  game.status = "results";
  const payload = {
    questionIndex: game.currentQuestionIndex,
    correctIndex: question.correctIndex,
    answerCounts,
    results,
    leaderboard: leaderboardOf(game),
  };
  game.lastQuestionResults = payload;
  return done(state, {
    broadcasts: [{ event: "question_results", data: payload }],
    clearTimer: true,
  });
}

function closeBuzz(state, now) {
  const round = state.buzz;
  if (!round || round.phase !== "join") return done(state, { clearTimer: true });
  if (round.buzzes.length) {
    round.phase = "typing";
  } else {
    round.phase = "done";
  }
  round.status = "closed";
  const payload = buzzPayload(round, now);
  return done(state, {
    broadcasts: [{ event: "buzzin_join_closed", data: payload }],
    clearTimer: true,
  });
}

function currentQuestionEvents(state) {
  const game = state.game;
  if (!game || game.currentQuestionIndex < 0) return [];
  if (game.status === "question") {
    const question = game.quiz.questions[game.currentQuestionIndex];
    return [{
      event: "question_start",
      data: {
        questionIndex: game.currentQuestionIndex,
        totalQuestions: game.quiz.questions.length,
        text: question.text,
        options: question.options,
        timeLimit: question.timeLimit || 15,
        endsAt: game.questionStartedAt + (question.timeLimit || 15) * 1000,
        points: pointsOf(game),
        image: question.image || null,
        fastMode: !!game.fastMode,
      },
    }];
  }
  if (game.status === "results" && game.lastQuestionResults) {
    return [{ event: "question_results", data: game.lastQuestionResults }];
  }
  if (game.status === "finished") {
    return [{ event: "game_finished", data: { leaderboard: leaderboardOf(game), exerciseLeaderboard: leaderboardOf(game), semesterLeaderboard: [] } }];
  }
  return [{ event: "game_starting", data: { totalQuestions: game.quiz.questions.length, fastMode: !!game.fastMode } }];
}

function done(state, extra = {}) {
  if (extra.timer) state && (state.timer = extra.timer);
  if (extra.clearTimer && state) delete state.timer;
  return {
    state,
    ack: extra.ack,
    broadcasts: extra.broadcasts || [],
    direct: extra.direct || [],
    attachment: extra.attachment || null,
    timer: extra.timer || null,
    clearTimer: !!extra.clearTimer,
  };
}

function beginHostGrace(state, now) {
  if (state.game && state.timer && state.timer.kind !== "host-grace") {
    state.game.pausedTimer = {
      kind: state.timer.kind,
      remainingMs: Math.max(0, state.timer.at - now),
    };
    state.game.hostDisconnectedAt = now;
  }
  return done(state, {
    broadcasts: [
      { event: "host_connection_lost", data: { graceMs: HOST_GRACE_MS } },
      lobby(state),
    ],
    timer: { kind: "host-grace", at: now + HOST_GRACE_MS },
  });
}

function resumeAfterHostGrace(state, now, extra) {
  if (state.game) state.game.hostDisconnectedAt = null;
  const paused = state.game?.pausedTimer || null;
  if (state.game) delete state.game.pausedTimer;
  if (paused?.kind === "question" && paused.remainingMs <= 0) {
    const finished = finishQuestion(state, now);
    finished.attachment = extra.attachment;
    finished.ack = extra.ack;
    finished.broadcasts = [...extra.broadcasts, ...finished.broadcasts];
    return finished;
  }
  if (paused && paused.remainingMs > 0) {
    const floor = paused.kind === "question" ? 1500 : 0;
    return done(state, {
      ...extra,
      timer: { kind: paused.kind, at: now + Math.max(floor, paused.remainingMs) },
    });
  }
  return done(state, { ...extra, clearTimer: true });
}

function expireHostGrace(state, now) {
  if (hasHostSocket(state)) {
    if (state.game) state.game.hostDisconnectedAt = null;
    const paused = state.game?.pausedTimer || null;
    if (state.game) delete state.game.pausedTimer;
    if (paused && paused.remainingMs > 0) {
      return done(state, { timer: { kind: paused.kind, at: Date.now() + paused.remainingMs } });
    }
    return done(state, { clearTimer: true });
  }
  queueOpenScores(state, now);
  state.game = null;
  state.buzz = null;
  state.session.status = "ended";
  state.session.hostSocketId = null;
  return done(state, {
    broadcasts: [
      { event: "game_ended", data: { reason: "Host connection lost" } },
      { event: "session_ended", data: { reason: "Host connection lost" } },
    ],
    clearTimer: true,
  });
}

// The exercise end_room_exercise names, as server.js resolveFinishedExercise
// does: a video can end after the host already moved the room on.
function finishedExercise(state, data) {
  const current = state.session.exercise || null;
  const id = Number(data?.exerciseId);
  if (Number.isFinite(id) && current?.id != null && Number(current.id) === id) return current;
  if (exerciseKind({ type: data?.exerciseType }) === "video" && Number.isFinite(id)) {
    return { id, type: data.exerciseType, title: current?.title || "", subTitle: current?.subTitle || "" };
  }
  return current;
}

function exerciseLabel(exercise) {
  if (!exercise?.id) return null;
  return { id: exercise.id, type: exercise.type || "", title: exercise.title || "", subTitle: exercise.subTitle || "" };
}

function hasHostSocket(state) {
  return Object.values(state.sockets || {}).some((item) => item?.role === "host");
}

function isHost(ctx) {
  return ctx.role === "host";
}

function rememberSocket(state, socketId, meta) {
  if (!state.sockets || typeof state.sockets !== "object") state.sockets = {};
  state.sockets[socketId] = meta;
}

function participantPayload(state) {
  return (state.session.participants || [])
    .slice()
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
    .map((item) => ({
      id: item.userId,
      userId: item.userId,
      displayName: item.displayName,
      isReady: !!item.isReady,
      online: item.online !== false,
      joinedAt: item.joinedAt,
    }));
}

function lobby(state) {
  return {
    event: "session_lobby_update",
    data: {
      roomId: state.session.roomId,
      status: state.session.status,
      participants: participantPayload(state),
      count: (state.session.participants || []).length,
      uiLocale: state.session.uiLocale || "en",
    },
  };
}

function localeEvent(state) {
  return { event: "session_locale", data: { roomId: state.session.roomId, uiLocale: state.session.uiLocale || "en" } };
}

function gameLobby(state) {
  return {
    event: "lobby_update",
    data: {
      pin: state.game.pin,
      quizTitle: state.game.quiz.title,
      players: state.game.players.map((item) => ({ id: item.id, name: item.name, score: item.score })),
      status: state.game.status,
    },
  };
}

function preload(state) {
  return { exercise: state.session.exercise || null, preloadExercises: [] };
}

function participantName(state, data, playerId) {
  const typed = clip(data.displayName || data.nickname, 40);
  if (typed) return typed;
  const student = (state.session.studentList || []).find((item) => String(item.id) === String(playerId) || String(item.studentCode || "") === String(playerId));
  return clip(student?.fullName || student?.name, 40);
}

function syncGamePlayers(state) {
  if (!state.game?.isRoomGame) return;
  for (const participant of state.session.participants || []) {
    if (!state.game.players.some((item) => item.id === participant.userId)) {
      state.game.players.push({
        id: participant.userId,
        name: participant.displayName,
        score: 0,
        correctAnswers: 0,
        participated: false,
      });
    }
  }
}

function normalizeQuiz(quiz) {
  const questions = (quiz?.questions || [])
    .map((question) => {
      const options = (question.options || [])
        .map((option) => (typeof option === "string" ? option : option?.text || option?.label || ""))
        .map((option) => String(option || "").trim())
        .filter(Boolean);
      return {
        text: clip(question.text || question.question, 500),
        options,
        correctIndex: Number.isInteger(Number(question.correctIndex)) ? Number(question.correctIndex) : 0,
        timeLimit: Number(question.timeLimit) > 0 ? Number(question.timeLimit) : 15,
        image: question.image || null,
      };
    })
    .filter((question) => question.options.length >= 2);
  return { title: clip(quiz?.title, 200) || "Quiz", questions, fastMode: !!quiz?.fastMode };
}

function pointsOf(game) {
  return game.fastMode ? FAST_POINTS : NORMAL_POINTS;
}

function leaderboardOf(game) {
  return game.players
    .map((item) => ({ id: item.id, name: item.name, score: item.score }))
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
}

function accuracyOf(game) {
  const total = game.quiz.questions.length || 1;
  return game.players
    .map((item) => ({
      id: item.id,
      name: item.name,
      correctAnswers: item.correctAnswers || 0,
      accuracyPercent: Math.round(((item.correctAnswers || 0) / total) * 100),
    }))
    .sort((a, b) => b.correctAnswers - a.correctAnswers || String(a.name).localeCompare(String(b.name)));
}

function buzzTopics(exercise) {
  const items = Array.isArray(exercise?.items) ? exercise.items : [];
  return items
    .map((item) => {
      const topic = clip(item?.topic || item?.title || item?.question || item?.text, 300);
      if (!topic) return null;
      return { topic, image: String(item?.image || item?.imageUrl || "").trim() };
    })
    .filter(Boolean);
}

function newBuzz(topics, index, now) {
  const current = topics[index] || topics[0];
  return {
    roundId: now,
    phase: "ready",
    status: "closed",
    topic: current.topic,
    image: current.image || "",
    topics,
    questionIndex: index,
    totalQuestions: topics.length,
    buzzes: [],
    responses: [],
    joinOpenedAt: 0,
    joinEndsAt: 0,
  };
}

function buzzPayload(round, now) {
  const remaining = round.phase === "join" ? Math.max(0, round.joinEndsAt - now) : 0;
  return {
    roundId: round.roundId,
    phase: round.phase,
    status: round.status,
    winners: round.buzzes.slice(0, 1),
    buzzes: round.buzzes,
    totalBuzzes: round.buzzes.length,
    winnerCount: 1,
    joinSeconds: BUZZ_JOIN_MS / 1000,
    joinOpenedAt: round.joinOpenedAt || 0,
    joinEndsAt: round.joinEndsAt,
    joinSecondsRemaining: Math.ceil(remaining / 1000),
    topic: round.topic || "",
    image: round.image || "",
    questionIndex: round.questionIndex,
    totalQuestions: round.totalQuestions,
    hasNextQuestion: round.questionIndex + 1 < round.totalQuestions,
    responses: round.responses,
    typingComplete: round.phase === "done",
    answeredPlayerIds: round.buzzes.map((item) => item.playerId),
  };
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}
