import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent, applyRoomTimer, markSocketClosed } from "./room-events.js";

function room() {
  return createRoomState({
    roomId: "123456",
    teacherId: 835,
    classItem: { id: 62, name: "5A" },
    now: 1000,
  });
}

test("host and student join the same room over socket events", () => {
  let state = room();
  const host = applyRoomEvent(state, { event: "host_session", data: { roomId: "123456", uiLocale: "en" } }, {
    socketId: "host-1",
    role: null,
    now: 2000,
    pick: () => 0,
  });
  state = host.state;
  assert.equal(host.ack.ok, true);
  assert.equal(host.attachment.role, "host");

  const student = applyRoomEvent(state, { event: "join_session", data: { displayName: "Ada", userId: "ada" } }, {
    socketId: "student-1",
    role: null,
    now: 3000,
    pick: () => 0,
  });
  state = student.state;
  assert.equal(student.ack.ok, true);
  assert.equal(student.ack.displayName, "Ada");
  assert.equal(state.session.participants.length, 1);
  assert.equal(student.broadcasts[0].event, "session_lobby_update");
  assert.equal(student.broadcasts[0].data.count, 1);
});

test("submit_answer scores the question and closes it when everyone has answered", () => {
  let state = room();
  state.session.participants = [{ userId: "ada", displayName: "Ada", online: true, joinedAt: 1 }];
  const created = applyRoomEvent(state, {
    event: "create_room_game",
    data: { quiz: { title: "Demo", questions: [{ text: "2+2", options: ["3", "4"], correctIndex: 1, timeLimit: 15 }] } },
  }, { socketId: "quiz-host", role: null, now: 4000, pick: () => 0 });
  state = created.state;
  const started = applyRoomEvent(state, { event: "start_room_game", data: {} }, {
    socketId: "quiz-host",
    role: "host",
    now: 4000,
    pick: () => 0,
  });
  state = started.state;
  assert.equal(started.broadcasts.some((frame) => frame.event === "question_preview"), true);

  const opened = applyRoomTimer(state, state.timer.at);
  state = opened.state;
  assert.equal(state.game.status, "question");

  const answered = applyRoomEvent(state, { event: "submit_answer", data: { answerIndex: 1 } }, {
    socketId: "quiz-student",
    role: "player",
    playerId: "ada",
    now: 6000,
    pick: () => 0,
  });
  assert.equal(answered.state.game.status, "results");
  assert.equal(answered.state.game.players[0].score, 300);
  assert.equal(answered.broadcasts.at(-1).event, "question_results");
});

test("buzz_in keeps the first student on that room", () => {
  let state = room();
  state.session.exercise = { id: 1, type: "buzzin", items: [{ topic: "Say hello" }] };
  state.session.participants = [{ userId: "ada", displayName: "Ada", online: true, joinedAt: 1 }];
  const started = applyRoomEvent(state, { event: "start_buzzin_round", data: {} }, {
    socketId: "host-1",
    role: "host",
    now: 5000,
    pick: () => 0,
  });
  state = started.state;
  const opened = applyRoomEvent(state, { event: "open_buzzin_join", data: {} }, {
    socketId: "host-1",
    role: "host",
    now: 6000,
    pick: () => 0,
  });
  state = opened.state;
  const buzz = applyRoomEvent(state, { event: "buzz_in", data: {} }, {
    socketId: "student-1",
    role: "session_player",
    playerId: "ada",
    now: 6500,
    pick: () => 0,
  });
  assert.equal(buzz.ack.ok, true);
  assert.equal(buzz.ack.rank, 1);
  assert.equal(buzz.state.buzz.phase, "typing");
  assert.equal(buzz.broadcasts[0].event, "buzzin_join_closed");
});

test("the last host socket starts a one-minute grace and pauses the question", () => {
  let state = room();
  state.sockets = { "host-1": { role: "host", playerId: null }, "quiz-host": { role: "host", playerId: null } };
  state.session.hostSocketId = "host-1";
  state.game = {
    pin: "123456",
    status: "question",
    quiz: { title: "Demo", questions: [{ text: "2+2", options: ["3", "4"], correctIndex: 1, timeLimit: 15 }], fastMode: false },
    isRoomGame: true,
    fastMode: false,
    players: [{ id: "ada", name: "Ada", score: 0, correctAnswers: 0 }],
    currentQuestionIndex: 0,
    questionStartedAt: 10000,
    answers: {},
    answerHistory: [],
  };
  state.timer = { kind: "question", at: 25000 };

  const oneSocket = markSocketClosed(state, { socketId: "quiz-host", now: 12000 });
  assert.notEqual(oneSocket.timer?.kind, "host-grace");
  state = oneSocket.state;

  const dropped = markSocketClosed(state, { socketId: "host-1", now: 12000 });
  assert.equal(dropped.timer.kind, "host-grace");
  assert.equal(dropped.timer.at, 12000 + 60000);
  assert.equal(dropped.broadcasts[0].event, "host_connection_lost");
  assert.equal(dropped.broadcasts[0].data.graceMs, 60000);
  assert.equal(dropped.state.game.pausedTimer.kind, "question");
  assert.equal(dropped.state.game.pausedTimer.remainingMs, 13000);
});

test("a returning host cancels the grace and restores the question timer", () => {
  let state = room();
  state.game = {
    pin: "123456",
    status: "question",
    quiz: { title: "Demo", questions: [{ text: "2+2", options: ["3", "4"], correctIndex: 1, timeLimit: 15 }], fastMode: false },
    isRoomGame: true,
    fastMode: false,
    players: [],
    currentQuestionIndex: 0,
    questionStartedAt: 10000,
    answers: {},
    answerHistory: [],
    pausedTimer: { kind: "question", remainingMs: 13000 },
    hostDisconnectedAt: 12000,
  };
  state.timer = { kind: "host-grace", at: 72000 };

  const back = applyRoomEvent(state, { event: "host_session", data: { roomId: "123456" } }, {
    socketId: "host-2",
    role: null,
    now: 20000,
    pick: () => 0,
  });
  assert.equal(back.ack.ok, true);
  assert.equal(back.timer.kind, "question");
  assert.equal(back.timer.at, 20000 + 13000);
  assert.equal(back.state.game.hostDisconnectedAt, null);
  assert.equal(back.state.session.status, "waiting");
});

test("the grace ends the class when the host does not return", () => {
  let state = room();
  state.session.participants = [{ userId: "ada", displayName: "Ada", online: true, joinedAt: 1 }];
  state.game = { pin: "123456", status: "question", players: [], quiz: { questions: [] } };
  state.timer = { kind: "host-grace", at: 72000 };

  const ended = applyRoomTimer(state, 72000);
  assert.equal(ended.state.session.status, "ended");
  assert.equal(ended.state.game, null);
  assert.equal(ended.clearTimer, true);
  assert.deepEqual(
    ended.broadcasts.map((frame) => frame.event),
    ["game_ended", "session_ended"]
  );
  assert.equal(ended.broadcasts[0].data.reason, "Host connection lost");
});

