// "Everyone Answers": like Buzz In, the teacher asks a spoken question, but
// there is no buzzing or lucky draw. Every student in the room records an
// answer at the same time and each answer is marked on its own.
//
// Privacy: a student only ever receives their own answer and feedback. The
// host gets every answer (and the answer key) through `hostData`; the frames
// a student receives carry counts only, and `openanswer_result` is addressed
// to the one student it belongs to (`toPlayer`).
import { audioRef, clip, done, isHost, isStudent, languageOf } from "./room-core.js";
import { awardOpenAnswer, openAnswerPoints } from "./room-scores.js";

const DEFAULT_ANSWER_SECONDS = 30;
const MIN_ANSWER_SECONDS = 10;
const MAX_ANSWER_SECONDS = 120;
// A recording that was running when the clock hit zero still has to be
// transcribed and sent; it counts if it arrives this soon after the close.
const LATE_GRACE_MS = 8000;
const RESPONSE_MAX = 500;

export function openAnswerTopics(exercise) {
  const items = Array.isArray(exercise?.items) ? exercise.items : [];
  return items
    .map((item) => {
      const topic = clip(item?.topic || item?.title || item?.question || item?.text, 300);
      if (!topic) return null;
      return {
        topic,
        image: String(item?.image || item?.imageUrl || "").trim(),
        correctAnswer: clip(item?.correctAnswer || item?.answer || item?.expectedAnswer, 500),
        sttLanguage: languageOf(item?.sttLanguage),
        answerSeconds: secondsOf(item?.timeLimit ?? item?.answerSeconds),
      };
    })
    .filter(Boolean);
}

function secondsOf(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_ANSWER_SECONDS;
  return Math.min(MAX_ANSWER_SECONDS, Math.max(MIN_ANSWER_SECONDS, seconds));
}

function newRound(topics, index, now) {
  const current = topics[index] || topics[0];
  return {
    roundId: now,
    phase: "ready",
    topic: current.topic,
    image: current.image || "",
    correctAnswer: current.correctAnswer || "",
    sttLanguage: current.sttLanguage || "",
    answerSeconds: current.answerSeconds || DEFAULT_ANSWER_SECONDS,
    topics,
    questionIndex: index,
    totalQuestions: topics.length,
    openedAt: 0,
    endsAt: 0,
    closedAt: 0,
    closeReason: "",
    responses: [],
  };
}

export function startOpenAnswer(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can start an Everyone Answers round." } });
  const topics = openAnswerTopics(state.session.exercise);
  if (!topics.length) return done(state, { ack: { ok: false, error: "This Everyone Answers exercise has no questions." } });
  // A fresh start is a fresh attempt: points from an earlier run are dropped.
  state.session.openAnswerExerciseId = state.session.exercise?.id ?? null;
  state.session.openAnswerPoints = {};
  state.open = newRound(topics, 0, ctx.now);
  return roundStarted(state, ctx);
}

export function nextOpenAnswer(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can advance Everyone Answers questions." } });
  const round = state.open;
  if (!round) return done(state, { ack: { ok: false, error: "Everyone Answers round not prepared." } });
  const nextIndex = round.questionIndex + 1;
  if (nextIndex >= round.topics.length) return done(state, { ack: { ok: false, error: "No more Everyone Answers questions." } });
  state.open = newRound(round.topics, nextIndex, ctx.now);
  return roundStarted(state, ctx);
}

// Uncle Tommy reads the question to the class before the host opens the
// window; the host's ack waits for the audio, as Buzz In does.
function roundStarted(state, ctx) {
  const round = state.open;
  const broadcasts = [frame("openanswer_round_started", state, round, ctx.now)];
  if (!ctx.caps?.speech || !round.topic) {
    return done(state, { ack: { ok: true, ...payload(state, round, ctx.now, true) }, broadcasts, clearTimer: true });
  }
  return done(state, {
    broadcasts,
    clearTimer: true,
    deferAck: true,
    jobs: [{
      kind: "open-topic",
      roundId: round.roundId,
      text: round.topic,
      language: speakLang(state),
      variant: state.session.variant || "",
    }],
  });
}

export function openAnswerWindow(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can open the answer window." } });
  const round = state.open;
  if (!round) return done(state, { ack: { ok: false, error: "Everyone Answers round not prepared." } });
  if (round.phase !== "ready") return done(state, { ack: { ok: false, error: "Answers are already open." } });
  round.phase = "answering";
  round.openedAt = ctx.now;
  round.endsAt = ctx.now + round.answerSeconds * 1000;
  return done(state, {
    ack: { ok: true, ...payload(state, round, ctx.now, true) },
    broadcasts: [frame("openanswer_opened", state, round, ctx.now)],
    timer: { kind: "open", at: round.endsAt },
  });
}

export function closeOpenAnswerEarly(state, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can close the answer window." } });
  const round = state.open;
  if (!round || round.phase !== "answering") return done(state, { ack: { ok: false, error: "Answers are not open." } });
  const closed = closeWindow(state, ctx.now, "host");
  closed.ack = { ok: true, ...payload(state, round, ctx.now, true) };
  return closed;
}

export function closeOpenAnswerTimer(state, now) {
  const round = state.open;
  if (!round || round.phase !== "answering") return done(state, { clearTimer: true });
  return closeWindow(state, now, "timeout");
}

function closeWindow(state, now, reason) {
  const round = state.open;
  round.phase = "done";
  round.closedAt = now;
  round.closeReason = reason;
  return done(state, {
    // Only the answer clock is cleared; a host-grace timer must survive.
    clearTimer: state.timer?.kind === "open",
    broadcasts: [frame("openanswer_closed", state, round, now)],
  });
}

export function getOpenAnswer(state, ctx) {
  const round = state.open;
  if (!round) return done(state, { ack: { ok: true, active: false } });
  const body = isHost(ctx)
    ? payload(state, round, ctx.now, true)
    : payload(state, round, ctx.now, false, ctx.playerId);
  return done(state, { ack: { ok: true, active: true, ...body } });
}

// Checked before the recording is transcribed, so a student who cannot
// answer does not cost a speech-to-text call.
export function openAnswerSubmitCheck(state, ctx) {
  const round = state?.open;
  const playerId = ctx.playerId;
  if (!isStudent(ctx) || !participantOf(state, playerId)) {
    return { ok: false, error: "Join the class waiting room first." };
  }
  if (!round) return { ok: false, error: "There is no question to answer right now." };
  if (round.phase === "ready") return { ok: false, error: "The question has not opened yet." };
  if (!accepting(round, ctx.now)) return { ok: false, error: "Time is up for this question." };
  if (responseOf(round, playerId)) return { ok: false, error: "You already submitted an answer." };
  return { ok: true, sttLanguage: round.sttLanguage || "" };
}

export function submitOpenAnswer(state, data, ctx) {
  const check = openAnswerSubmitCheck(state, ctx);
  if (!check.ok) return done(state, { ack: check });
  const round = state.open;
  const playerId = ctx.playerId;
  const text = String(data.text || "").trim();
  if (!text) return done(state, { ack: { ok: false, error: "Record your answer before submitting." } });
  if (text.length > RESPONSE_MAX) {
    return done(state, { ack: { ok: false, error: `Answer must be ${RESPONSE_MAX} characters or fewer.` } });
  }
  const name = participantOf(state, playerId).displayName || "Student";
  const audioId = clip(data.responseAudioId, 80);
  const entry = {
    playerId,
    displayName: name,
    text,
    at: ctx.now,
    responseAudio: audioId ? audioRef(audioId) : null,
    responseAudioFormat: audioId ? clip(data.responseAudioFormat, 16) || "webm" : null,
    analysis: null,
    spokenFeedback: null,
    answerVerdict: null,
    isCorrect: null,
    points: 0,
    analysisStatus: "pending",
  };
  round.responses.push(entry);

  const broadcasts = [frame("openanswer_update", state, round, ctx.now)];
  const jobs = [];
  if (!ctx.caps?.text) {
    // No marking model: keep the answer, award nothing.
    entry.analysis = "";
    entry.analysisStatus = "done";
  } else {
    jobs.push({
      kind: "open-analyze",
      roundId: round.roundId,
      exerciseId: state.session.exercise?.id ?? null,
      playerId,
      at: entry.at,
      topic: round.topic,
      correctAnswer: round.correctAnswer || "",
      studentName: name,
      responseText: text,
      hasAudio: !!audioId || !!data.hadAudio,
      language: round.sttLanguage || speakLang(state),
      speakLanguage: round.sttLanguage || speakLang(state),
      variant: state.session.variant || "",
      speech: false,
    });
  }
  const result = done(state, { jobs, broadcasts });
  // Everyone who is online has answered: no reason to keep the class waiting.
  if (round.phase === "answering" && everyoneAnswered(state, round)) {
    const closed = closeWindow(state, ctx.now, "all");
    result.broadcasts.push(...closed.broadcasts);
    result.clearTimer = closed.clearTimer;
  }
  result.ack = { ok: true, ...payload(state, round, ctx.now, false, playerId) };
  return result;
}

export function applyOpenAnswerJob(state, job, outcome, now) {
  if (job.kind === "open-topic") return topicSpoken(state, job, outcome, now);
  if (job.kind === "open-analyze") return analyzed(state, job, outcome, now);
  return done(state);
}

function topicSpoken(state, job, outcome, now) {
  const round = state.open;
  if (!round || round.roundId !== job.roundId) return done(state, { ack: { ok: false, error: "Everyone Answers round changed." } });
  return done(state, {
    ack: {
      ok: true,
      ...payload(state, round, now, true),
      topicAudio: outcome?.audioId ? audioRef(outcome.audioId) : null,
      topicAudioFormat: outcome?.audioId ? outcome.format || "mp3" : null,
    },
  });
}

function analyzed(state, job, outcome, now) {
  const points = outcome?.ok ? openAnswerPoints(outcome.answerVerdict) : 0;
  // The host may have moved to the next question while the model worked; the
  // points still count for the exercise even though the round is gone.
  if (points && String(state.session.openAnswerExerciseId) === String(job.exerciseId)) {
    awardOpenAnswer(state, job.playerId, job.studentName, points);
  }
  const round = state.open;
  if (!round || round.roundId !== job.roundId) return done(state);
  const entry = responseOf(round, job.playerId);
  if (!entry || entry.at !== job.at || entry.analysisStatus !== "pending") return done(state);
  if (outcome?.ok) {
    entry.analysis = outcome.analysis;
    entry.spokenFeedback = outcome.spokenFeedback;
    entry.answerVerdict = outcome.answerVerdict || null;
    entry.isCorrect = outcome.isCorrect === true;
    entry.points = points;
    entry.analysisStatus = "done";
  } else {
    entry.analysis = outcome?.error || "Analysis failed.";
    entry.analysisStatus = "error";
  }
  return done(state, {
    broadcasts: [
      frame("openanswer_update", state, round, now),
      { event: "openanswer_result", toPlayer: job.playerId, data: payload(state, round, now, false, job.playerId) },
    ],
  });
}

// Back from a host disconnect: the answer clock was replaced by the grace
// timer, so it is rebuilt from the stored deadline.
export function openAnswerTimer(state, now) {
  const round = state?.open;
  if (!round || round.phase !== "answering") return null;
  return { kind: "open", at: Math.max(round.endsAt, now + 250) };
}

function accepting(round, now) {
  if (round.phase === "answering") return true;
  return round.phase === "done" && round.closeReason === "timeout" && now <= round.endsAt + LATE_GRACE_MS;
}

function participantOf(state, playerId) {
  return (state.session.participants || []).find((item) => item.userId === playerId) || null;
}

function responseOf(round, playerId) {
  return (round.responses || []).find((item) => item.playerId === playerId) || null;
}

function onlineParticipants(state) {
  return (state.session.participants || []).filter((item) => item.online !== false);
}

function everyoneAnswered(state, round) {
  const online = onlineParticipants(state);
  return online.length > 0 && online.every((item) => responseOf(round, item.userId));
}

function speakLang(state) {
  return (
    languageOf(state.session.exercise?.speakLangCode) ||
    languageOf(state.session.courseLangCode) ||
    (state.session.variant === "hk-elderly" ? "yue" : "en")
  );
}

// What one student may see of their own answer: no audio references.
function mineOf(round, playerId) {
  const entry = playerId ? responseOf(round, playerId) : null;
  if (!entry) return null;
  return {
    text: entry.text,
    at: entry.at,
    analysis: entry.analysis,
    spokenFeedback: entry.spokenFeedback,
    answerVerdict: entry.answerVerdict,
    isCorrect: entry.isCorrect,
    points: entry.points,
    analysisStatus: entry.analysisStatus,
    hasResponseAudio: Boolean(entry.responseAudio),
  };
}

// The host sees every answer and the answer key; a student gets counts, plus
// their own answer when `viewerId` is given.
function payload(state, round, now, forHost, viewerId = null) {
  const remaining = round.phase === "answering" ? Math.max(0, round.endsAt - now) : 0;
  const body = {
    roundId: round.roundId,
    phase: round.phase,
    topic: round.topic || "",
    image: round.image || "",
    questionIndex: round.questionIndex,
    totalQuestions: round.totalQuestions,
    hasNextQuestion: round.questionIndex + 1 < round.totalQuestions,
    answerSeconds: round.answerSeconds,
    openedAt: round.openedAt || 0,
    endsAt: round.endsAt || 0,
    serverNow: now,
    secondsRemaining: Math.ceil(remaining / 1000),
    closeReason: round.closeReason || "",
    submittedCount: round.responses.length,
    totalStudents: Math.max(onlineParticipants(state).length, round.responses.length),
  };
  if (forHost) {
    return {
      ...body,
      correctAnswer: round.correctAnswer || "",
      responses: round.responses.map((entry) => ({ ...entry })),
    };
  }
  const mine = mineOf(round, viewerId);
  return mine ? { ...body, mine } : body;
}

function frame(event, state, round, now) {
  return { event, data: payload(state, round, now, false), hostData: payload(state, round, now, true) };
}
