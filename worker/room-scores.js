// Score batches a room queues for D1. Points follow server.js: quiz points as
// earned, 200 for a video, 300 for a buzz-in answer. The Durable Object
// writes queued batches and removes them once D1 has them.
const VIDEO_POINTS = 200;
const BUZZIN_POINTS = 300;
// Everyone Answers marks every student, so points follow the verdict.
const OPEN_ANSWER_POINTS = { correct: 300, partial: 150 };

export function exerciseKind(exercise) {
  const type = String(exercise?.type || "").toLowerCase().replace(/[_\s-]/g, "");
  if (type === "mcquiz" || type === "fastmcquiz") return "quiz";
  if (type === "video") return "video";
  if (type === "buzzin") return "buzzin";
  if (type === "openanswer") return "openanswer";
  return "";
}

// Quiz points earned so far. A game is queued once, so a natural finish
// followed by end_room_exercise saves it a single time.
export function queueQuizScores(state, now) {
  const game = state?.game;
  if (!game || game.scoresQueued) return false;
  game.scoresQueued = true;
  const scores = (game.players || [])
    .filter((player) => !game.isRoomGame || player.participated)
    .map((player) => ({
      studentUserId: player.id,
      displayName: displayNameOf(state, player.id, player.name),
      score: player.score,
    }));
  const exercise = game.exercise || state.session.exercise;
  return queue(state, batchOf(state, exercise, game.courseId, scores, "mcquiz"), now);
}

export function queueVideoScores(state, exercise, now) {
  if (exerciseKind(exercise) !== "video") return false;
  const scores = (state.session.participants || []).map((participant) => ({
    studentUserId: participant.userId,
    displayName: participant.displayName || "Student",
    score: VIDEO_POINTS,
  }));
  return queue(state, batchOf(state, exercise, state.session.courseId, scores, "video"), now);
}

// Everyone in the room, 300 for each student who buzzed in or was drawn.
function buzzScoresOf(state) {
  const awarded = new Map(state.session.buzzinAwardedPlayers || []);
  const winner = state.buzz?.buzzes?.[0];
  if (winner) awarded.set(winner.playerId, winner.displayName || "Student");
  const scores = (state.session.participants || []).map((participant) => ({
    studentUserId: participant.userId,
    displayName: participant.displayName || "Student",
    score: awarded.has(participant.userId) ? BUZZIN_POINTS : 0,
  }));
  for (const [playerId, displayName] of awarded) {
    if (!scores.some((entry) => entry.studentUserId === playerId)) {
      scores.push({ studentUserId: playerId, displayName: displayName || "Student", score: BUZZIN_POINTS });
    }
  }
  return scores;
}

// This exercise's points for the wrap-up screen, as server.js
// getBuzzinExerciseLeaderboard. Read it before queueBuzzScores clears them.
export function buzzLeaderboard(state, exercise) {
  if (exerciseKind(exercise) !== "buzzin") return null;
  return buzzScoresOf(state)
    .map((entry) => ({ id: entry.studentUserId, name: entry.displayName, score: entry.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function queueBuzzScores(state, exercise, now) {
  if (exerciseKind(exercise) !== "buzzin") return false;
  const scores = buzzScoresOf(state);
  state.session.buzzinExerciseId = null;
  state.session.buzzinAwardedPlayers = [];
  return queue(state, batchOf(state, exercise, state.session.courseId, scores, "buzzin"), now);
}

export function openAnswerPoints(verdict) {
  if (verdict === "correct") return OPEN_ANSWER_POINTS.correct;
  if (verdict === "partial") return OPEN_ANSWER_POINTS.partial;
  return 0;
}

// Points add up per student across the exercise's questions.
export function awardOpenAnswer(state, playerId, displayName, points) {
  if (!state.session.openAnswerPoints || typeof state.session.openAnswerPoints !== "object") {
    state.session.openAnswerPoints = {};
  }
  const entry = state.session.openAnswerPoints[playerId] || { name: displayName || "Student", points: 0 };
  entry.points += points;
  if (displayName) entry.name = displayName;
  state.session.openAnswerPoints[playerId] = entry;
}

export function queueOpenAnswerScores(state, exercise, now) {
  if (exerciseKind(exercise) !== "openanswer") return false;
  const earned = state.session.openAnswerPoints || {};
  const scores = (state.session.participants || []).map((participant) => ({
    studentUserId: participant.userId,
    displayName: participant.displayName || "Student",
    score: earned[participant.userId]?.points || 0,
  }));
  for (const [playerId, entry] of Object.entries(earned)) {
    if (!scores.some((item) => item.studentUserId === playerId)) {
      scores.push({ studentUserId: playerId, displayName: entry.name || "Student", score: entry.points });
    }
  }
  state.session.openAnswerExerciseId = null;
  state.session.openAnswerPoints = {};
  return queue(state, batchOf(state, exercise, state.session.courseId, scores, "openanswer"), now);
}

// Points already earned when a room stops without end_room_exercise: the next
// exercise starts, the host does not come back, or the session ends. Videos
// are left out, as on Node, because nobody confirmed the video finished.
export function queueOpenScores(state, now) {
  if (!state?.session) return false;
  const quiz = queueQuizScores(state, now);
  const exercise = state.session.exercise;
  const buzz = state.session.buzzinExerciseId != null && sameId(state.session.buzzinExerciseId, exercise?.id)
    ? queueBuzzScores(state, exercise, now)
    : false;
  const open = state.session.openAnswerExerciseId != null && sameId(state.session.openAnswerExerciseId, exercise?.id)
    ? queueOpenAnswerScores(state, exercise, now)
    : false;
  return quiz || buzz || open;
}

export function awardBuzz(state, playerId, displayName) {
  const awarded = (state.session.buzzinAwardedPlayers || []).filter(([id]) => id !== playerId);
  awarded.push([playerId, displayName || "Student"]);
  state.session.buzzinAwardedPlayers = awarded;
}

function batchOf(state, exercise, courseId, scores, fallbackType) {
  const session = state.session;
  if (session.teacherId == null || session.teacherId === "" || session.classId == null || !exercise?.id) return null;
  return {
    teacherId: session.teacherId,
    classId: session.classId,
    courseId: courseId ?? session.courseId ?? null,
    exerciseId: exercise.id,
    exerciseTitle: exercise.title || exercise.subTitle || "",
    exerciseType: exercise.type || fallbackType,
    roomId: session.roomId,
    scores,
  };
}

function queue(state, batch, now) {
  if (!batch || !batch.scores.length) return false;
  if (!Array.isArray(state.pendingScores)) state.pendingScores = [];
  state.pendingScores.push({ id: `${batch.exerciseId}:${batch.exerciseType}:${now}:${state.pendingScores.length}`, ...batch });
  return true;
}

function displayNameOf(state, playerId, fallback) {
  const participant = (state.session.participants || []).find((item) => item.userId === playerId);
  const student = (state.session.studentList || []).find((item) => String(item.id) === String(playerId));
  return participant?.displayName || fallback || student?.fullName || "Student";
}

function sameId(left, right) {
  return String(left) === String(right);
}
