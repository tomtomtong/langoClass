import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent, applyRoomTimer } from "./room-events.js";
import { queueOpenScores } from "./room-scores.js";

const QUIZ = {
  title: "Demo",
  questions: [
    { text: "2+2", options: ["3", "4"], correctIndex: 1, timeLimit: 15 },
    { text: "3+3", options: ["6", "7"], correctIndex: 0, timeLimit: 15 },
  ],
};

function room(exercise = { id: 11, type: "mcquiz", title: "Sums" }) {
  const state = createRoomState({
    roomId: "123456",
    teacherId: 835,
    classItem: { id: 62, name: "5A" },
    course: { id: 7, name: "Maths" },
    exercise,
    now: 1000,
  });
  state.session.participants = [
    { userId: "ada", displayName: "Ada", online: true, joinedAt: 1 },
    { userId: "bo", displayName: "Bo", online: true, joinedAt: 2 },
  ];
  return state;
}

const host = (now) => ({ socketId: "host-1", role: "host", now, pick: () => 0 });
const player = (id, now) => ({ socketId: `s-${id}`, role: "player", playerId: id, now, pick: () => 0 });

function send(state, event, data, ctx) {
  return applyRoomEvent(state, { event, data }, ctx).state;
}

// Starts the quiz and lets Ada answer the first question correctly; Bo never answers.
function quizAfterOneQuestion() {
  let state = room();
  state = send(state, "create_room_game", { quiz: QUIZ }, host(2000));
  state = send(state, "join_room_game", { userId: "ada" }, player("ada", 2100));
  state = send(state, "start_room_game", {}, host(3000));
  state = applyRoomTimer(state, state.timer.at).state;
  state = send(state, "submit_answer", { answerIndex: 1 }, player("ada", 9000));
  state = applyRoomTimer(state, state.timer.at).state;
  return state;
}

test("a finished quiz queues its scores once", () => {
  let state = quizAfterOneQuestion();
  state = send(state, "next_question", {}, host(30000));
  state = applyRoomTimer(state, state.timer.at).state;
  state = applyRoomTimer(state, state.timer.at).state;
  state = send(state, "next_question", {}, host(60000));
  assert.equal(state.game.status, "finished");
  assert.equal(state.pendingScores.length, 1);

  const [batch] = state.pendingScores;
  assert.equal(batch.teacherId, 835);
  assert.equal(batch.classId, 62);
  assert.equal(batch.courseId, 7);
  assert.equal(batch.exerciseId, 11);
  assert.equal(batch.exerciseType, "mcquiz");
  assert.equal(batch.roomId, "123456");
  assert.deepEqual(batch.scores, [{ studentUserId: "ada", displayName: "Ada", score: 300 }]);

  state = send(state, "end_room_exercise", { exerciseId: 11, exerciseType: "mcquiz" }, host(61000));
  assert.equal(state.pendingScores.length, 1);
  assert.equal(state.game, null);
});

test("ending a quiz early queues the points earned so far", () => {
  let state = quizAfterOneQuestion();
  const ended = applyRoomEvent(state, { event: "end_room_exercise", data: { exerciseId: 11 } }, host(31000));
  state = ended.state;
  assert.equal(ended.ack.ok, true);
  assert.equal(state.game, null);
  assert.equal(state.pendingScores.length, 1);
  assert.deepEqual(state.pendingScores[0].scores, [{ studentUserId: "ada", displayName: "Ada", score: 300 }]);
});

test("ending a video gives every student in the room 200 points", () => {
  let state = room({ id: 12, type: "video", title: "Clip" });
  state = send(state, "end_room_exercise", { exerciseId: 12, exerciseType: "video" }, host(5000));
  assert.equal(state.pendingScores.length, 1);
  assert.equal(state.pendingScores[0].exerciseType, "video");
  assert.deepEqual(
    state.pendingScores[0].scores.map((entry) => [entry.studentUserId, entry.score]),
    [["ada", 200], ["bo", 200]]
  );
});

test("a buzz-in winner gets 300 points and the rest get 0", () => {
  let state = room({ id: 13, type: "buzzin", items: [{ topic: "Say hello" }] });
  state = send(state, "start_buzzin_round", {}, host(5000));
  state = send(state, "open_buzzin_join", {}, host(6000));
  state = send(state, "buzz_in", {}, { ...player("bo", 6500), role: "session_player" });
  state = send(state, "end_room_exercise", { exerciseId: 13, exerciseType: "buzzin" }, host(9000));
  assert.equal(state.pendingScores.length, 1);
  assert.deepEqual(
    state.pendingScores[0].scores.map((entry) => [entry.studentUserId, entry.score]),
    [["ada", 0], ["bo", 300]]
  );
  assert.deepEqual(state.session.buzzinAwardedPlayers, []);
});

test("a host who does not return still has the quiz scores saved", () => {
  let state = quizAfterOneQuestion();
  state.sockets = {};
  state.timer = { kind: "host-grace", at: 90000 };
  state = applyRoomTimer(state, 90000).state;
  assert.equal(state.session.status, "ended");
  assert.equal(state.pendingScores.length, 1);
  assert.equal(state.pendingScores[0].scores[0].score, 300);
});

test("starting the next exercise queues the unfinished quiz", () => {
  let state = quizAfterOneQuestion();
  state = send(state, "start_next_exercise", { exercise: { id: 14, type: "video" } }, host(40000));
  assert.equal(state.pendingScores.length, 1);
  assert.equal(state.pendingScores[0].exerciseId, 11);
});

test("closing a session queues open scores but not an unconfirmed video", () => {
  const quiz = quizAfterOneQuestion();
  assert.equal(queueOpenScores(quiz, 50000), true);
  assert.equal(queueOpenScores(quiz, 50001), false);
  assert.equal(quiz.pendingScores.length, 1);

  const video = room({ id: 12, type: "video" });
  assert.equal(queueOpenScores(video, 50000), false);
  assert.equal(video.pendingScores, undefined);
});
