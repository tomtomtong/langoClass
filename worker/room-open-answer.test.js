import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent, applyRoomJob, applyRoomTimer, openAnswerSubmitCheck } from "./room-events.js";

const SPEECH = { speech: true, text: true };
const NO_MODEL = { speech: false, text: false };

function openRoom(caps = SPEECH) {
  let state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "5A" }, now: 1000 });
  state.sockets = { "host-1": { role: "host", playerId: null } };
  state.session.exercise = {
    id: 9,
    type: "openanswer",
    items: [
      { topic: "Name a fruit", correctAnswer: "apple", timeLimit: 20 },
      { topic: "Name a colour" },
    ],
  };
  state.session.participants = [
    { userId: "ada", displayName: "Ada", online: true, joinedAt: 1 },
    { userId: "bo", displayName: "Bo", online: true, joinedAt: 2 },
    { userId: "cy", displayName: "Cy", online: true, joinedAt: 3 },
  ];
  state = host(state, "start_openanswer_round", {}, 2000, caps).state;
  return state;
}

function openedRoom(caps = SPEECH) {
  return host(openRoom(caps), "open_openanswer_window", {}, 3000, caps).state;
}

function host(state, event, data, now, caps = SPEECH) {
  return applyRoomEvent(state, { event, data }, { socketId: "host-1", role: "host", now, pick: () => 0, caps });
}

function student(state, playerId, event, data, now, caps = SPEECH) {
  return applyRoomEvent(state, { event, data }, {
    socketId: `${playerId}-socket`,
    role: "session_player",
    playerId,
    now,
    pick: () => 0,
    caps,
  });
}

function answer(state, playerId, text, now, caps = SPEECH) {
  return student(state, playerId, "submit_openanswer_response", { text }, now, caps);
}

test("the host starts a round; the topic is read aloud before the window opens", () => {
  const started = host(
    createRoomWith(),
    "start_openanswer_round",
    {},
    2000
  );
  assert.equal(started.state.open.phase, "ready");
  assert.equal(started.ack, undefined);
  assert.equal(started.deferAck, true);
  assert.deepEqual(started.jobs.map((job) => job.kind), ["open-topic"]);
  assert.equal(started.broadcasts[0].event, "openanswer_round_started");
  assert.equal(started.broadcasts[0].data.correctAnswer, undefined);
  assert.equal(started.broadcasts[0].hostData.correctAnswer, "apple");

  const spoken = applyRoomJob(started.state, started.jobs[0], { audioId: "t1", format: "mp3" }, 2500);
  assert.equal(spoken.ack.ok, true);
  assert.equal(spoken.ack.topicAudio, "audio:t1");
});

test("without speech the host ack comes straight back", () => {
  const started = host(createRoomWith(), "start_openanswer_round", {}, 2000, NO_MODEL);
  assert.equal(started.ack.ok, true);
  assert.equal(started.ack.topic, "Name a fruit");
  assert.equal(started.jobs.length, 0);
});

test("only the host can start, open or close a round", () => {
  const room = createRoomWith();
  assert.equal(student(room, "ada", "start_openanswer_round", {}, 2000).ack.ok, false);
  const ready = openRoom();
  assert.equal(student(ready, "ada", "open_openanswer_window", {}, 3000).ack.ok, false);
  const opened = openedRoom();
  assert.equal(student(opened, "ada", "close_openanswer_window", {}, 4000).ack.ok, false);
});

test("an exercise with no questions cannot start", () => {
  const room = createRoomWith();
  room.session.exercise = { id: 9, type: "openanswer", items: [] };
  const started = host(room, "start_openanswer_round", {}, 2000);
  assert.equal(started.ack.ok, false);
  assert.equal(started.state.open ?? null, null);
});

test("opening the window sets the deadline from the question's time limit", () => {
  const opened = host(openRoom(), "open_openanswer_window", {}, 3000);
  assert.equal(opened.ack.ok, true);
  assert.equal(opened.state.open.phase, "answering");
  assert.equal(opened.state.open.endsAt, 3000 + 20 * 1000);
  assert.deepEqual(opened.timer, { kind: "open", at: 23000 });
  assert.equal(opened.broadcasts[0].event, "openanswer_opened");
  assert.equal(host(opened.state, "open_openanswer_window", {}, 3100).ack.ok, false);
});

test("the second question falls back to 30 seconds and the time limit is bounded", () => {
  let state = openedRoom();
  state = host(state, "next_openanswer_question", {}, 4000, NO_MODEL).state;
  assert.equal(state.open.topic, "Name a colour");
  assert.equal(state.open.answerSeconds, 30);
  state.session.exercise.items[1].timeLimit = 9999;
  state = host(state, "start_openanswer_round", {}, 5000, NO_MODEL).state;
  state = host(state, "next_openanswer_question", {}, 6000, NO_MODEL).state;
  assert.equal(state.open.answerSeconds, 120);
});

test("every student can answer, and nobody is picked or locked out", () => {
  let state = openedRoom();
  for (const [id, at] of [["ada", 4000], ["bo", 4100]]) {
    const result = answer(state, id, "apple", at);
    assert.equal(result.ack.ok, true);
    assert.equal(result.ack.mine.text, "apple");
    assert.equal(result.ack.mine.analysisStatus, "pending");
    assert.equal(result.jobs[0].kind, "open-analyze");
    assert.equal(result.jobs[0].playerId, id);
    state = result.state;
  }
  assert.equal(state.open.responses.length, 2);
  assert.equal(state.open.phase, "answering");
});

test("students see counts only; the host sees every answer and the key", () => {
  const state = openedRoom();
  const result = answer(state, "ada", "an apple", 4000);
  const update = result.broadcasts.find((item) => item.event === "openanswer_update");
  assert.equal(update.data.submittedCount, 1);
  assert.equal(update.data.totalStudents, 3);
  assert.equal(update.data.responses, undefined);
  assert.equal(update.data.mine, undefined);
  assert.equal(update.data.correctAnswer, undefined);
  assert.equal(update.hostData.correctAnswer, "apple");
  assert.equal(update.hostData.responses[0].text, "an apple");
  assert.equal(JSON.stringify(update.data).includes("an apple"), false);
});

test("a student can read their own state but never another student's answer", () => {
  let state = openedRoom();
  state = answer(state, "ada", "an apple", 4000).state;
  const ada = student(state, "ada", "get_openanswer_state", {}, 4100);
  assert.equal(ada.ack.mine.text, "an apple");
  const bo = student(state, "bo", "get_openanswer_state", {}, 4100);
  assert.equal(bo.ack.mine, undefined);
  assert.equal(JSON.stringify(bo.ack).includes("an apple"), false);
  const teacher = host(state, "get_openanswer_state", {}, 4100);
  assert.equal(teacher.ack.responses.length, 1);
  assert.equal(teacher.ack.correctAnswer, "apple");
});

test("the audio reference stays host-side", () => {
  const state = openedRoom();
  const result = student(state, "ada", "submit_openanswer_response", { text: "apple", responseAudioId: "r1", hadAudio: true }, 4000);
  assert.equal(result.ack.mine.hasResponseAudio, true);
  assert.equal(JSON.stringify(result.ack).includes("audio:r1"), false);
  const update = result.broadcasts.find((item) => item.event === "openanswer_update");
  assert.equal(update.hostData.responses[0].responseAudio, "audio:r1");
});

test("a second answer from the same student is refused", () => {
  const state = answer(openedRoom(), "ada", "apple", 4000).state;
  const again = answer(state, "ada", "pear", 4100);
  assert.equal(again.ack.ok, false);
  assert.match(again.ack.error, /already submitted/);
  assert.equal(again.state.open.responses.length, 1);
});

test("answers are refused before the window opens, from non-students, and when empty", () => {
  const ready = openRoom();
  assert.equal(answer(ready, "ada", "apple", 2500).ack.ok, false);
  const opened = openedRoom();
  assert.equal(openAnswerSubmitCheck(opened, { role: "host", now: 4000 }).ok, false);
  assert.equal(openAnswerSubmitCheck(opened, { role: "session_player", playerId: "stranger", now: 4000 }).ok, false);
  assert.equal(openAnswerSubmitCheck(opened, { role: null, playerId: null, now: 4000 }).ok, false);
  assert.equal(answer(opened, "ada", "   ", 4000).ack.ok, false);
  assert.equal(answer(opened, "ada", "x".repeat(501), 4000).ack.ok, false);
  assert.equal(openAnswerSubmitCheck(opened, { role: "session_player", playerId: "ada", now: 4000 }).ok, true);
});

test("the timer closes the window, and a recording in flight still counts for a few seconds", () => {
  let state = answer(openedRoom(), "ada", "apple", 4000).state;
  const closed = applyRoomTimer(state, 23000, SPEECH);
  assert.equal(closed.state.open.phase, "done");
  assert.equal(closed.state.open.closeReason, "timeout");
  assert.equal(closed.broadcasts[0].event, "openanswer_closed");
  assert.equal(closed.clearTimer, true);
  state = closed.state;
  assert.equal(answer(state, "bo", "apple", 25000).ack.ok, true);
  assert.equal(answer(state, "cy", "apple", 23000 + 8001).ack.ok, false);
});

test("the timer does nothing early", () => {
  const state = openedRoom();
  const early = applyRoomTimer(state, 10000, SPEECH);
  assert.equal(early.state.open.phase, "answering");
});

test("the host closing early stops late answers", () => {
  const state = openedRoom();
  const closed = host(state, "close_openanswer_window", {}, 5000);
  assert.equal(closed.ack.ok, true);
  assert.equal(closed.state.open.closeReason, "host");
  assert.equal(answer(closed.state, "ada", "apple", 5100).ack.ok, false);
  assert.equal(host(closed.state, "close_openanswer_window", {}, 5200).ack.ok, false);
});

test("the window closes by itself once every online student has answered", () => {
  let state = openedRoom();
  state.session.participants[2].online = false;
  state = answer(state, "ada", "apple", 4000).state;
  const last = answer(state, "bo", "apple", 4100);
  assert.equal(last.state.open.phase, "done");
  assert.equal(last.state.open.closeReason, "all");
  assert.equal(last.clearTimer, true);
  assert.deepEqual(last.broadcasts.map((item) => item.event), ["openanswer_update", "openanswer_closed"]);
  assert.equal(last.state.timer, undefined);
});

test("closing does not drop a host-grace timer", () => {
  let state = openedRoom();
  state.timer = { kind: "host-grace", at: 99000 };
  state.session.participants = state.session.participants.slice(0, 1);
  const last = answer(state, "ada", "apple", 4000);
  assert.equal(last.state.open.phase, "done");
  assert.equal(last.clearTimer, false);
  assert.equal(last.state.timer.kind, "host-grace");
});

test("each answer is marked on its own and only its student gets the result", () => {
  let state = openedRoom();
  const first = answer(state, "ada", "apple", 4000);
  state = answer(first.state, "bo", "banana", 4100).state;
  const marked = applyRoomJob(state, first.jobs[0], {
    ok: true,
    analysis: "✅ Correctness (90): Spot on",
    spokenFeedback: "Well done Ada!",
    answerVerdict: "correct",
    isCorrect: true,
  }, 5000);
  const ada = state.open.responses.find((item) => item.playerId === "ada");
  assert.equal(ada.analysisStatus, "done");
  assert.equal(ada.points, 300);
  assert.equal(state.open.responses.find((item) => item.playerId === "bo").analysisStatus, "pending");
  const result = marked.broadcasts.find((item) => item.event === "openanswer_result");
  assert.equal(result.toPlayer, "ada");
  assert.equal(result.data.mine.spokenFeedback, "Well done Ada!");
  assert.equal(result.data.mine.points, 300);
  assert.equal(result.data.mine.answerVerdict, "correct");
  const update = marked.broadcasts.find((item) => item.event === "openanswer_update");
  assert.equal(update.hostData.responses[0].answerVerdict, "correct");
  assert.equal(JSON.stringify(update.data).includes("Well done"), false);
});

test("the marking prompt carries the answer key and the student's own text", () => {
  const first = answer(openedRoom(), "ada", "an apple", 4000);
  const job = first.jobs[0];
  assert.equal(job.correctAnswer, "apple");
  assert.equal(job.studentName, "Ada");
  assert.equal(job.responseText, "an apple");
  assert.equal(job.speech, false);
  assert.equal(job.exerciseId, 9);
});

test("a marking failure is shown to that student only and earns nothing", () => {
  const first = answer(openedRoom(), "ada", "apple", 4000);
  const failed = applyRoomJob(first.state, first.jobs[0], { ok: false, error: "Model busy" }, 5000);
  assert.equal(first.state.open.responses[0].analysisStatus, "error");
  assert.equal(first.state.open.responses[0].points, 0);
  assert.equal(failed.broadcasts.find((item) => item.event === "openanswer_result").toPlayer, "ada");
});

test("without a marking model the answer is kept and earns nothing", () => {
  const state = openedRoom(NO_MODEL);
  const result = answer(state, "ada", "apple", 4000, NO_MODEL);
  assert.equal(result.ack.ok, true);
  assert.equal(result.jobs.length, 0);
  assert.equal(result.state.open.responses[0].analysisStatus, "done");
  assert.equal(result.ack.mine.points, 0);
});

test("a result for a question the host already left still counts toward the score", () => {
  let state = openedRoom();
  const first = answer(state, "ada", "apple", 4000);
  state = host(first.state, "next_openanswer_question", {}, 5000, NO_MODEL).state;
  const late = applyRoomJob(state, first.jobs[0], {
    ok: true,
    analysis: "",
    spokenFeedback: "",
    answerVerdict: "partial",
    isCorrect: false,
  }, 6000);
  assert.deepEqual(late.broadcasts, []);
  assert.equal(state.session.openAnswerPoints.ada.points, 150);
  assert.equal(state.open.responses.length, 0);
});

test("a stale result from an earlier exercise is ignored", () => {
  const state = openedRoom();
  const first = answer(state, "ada", "apple", 4000);
  first.state.session.openAnswerExerciseId = 77;
  applyRoomJob(first.state, first.jobs[0], { ok: true, analysis: "", answerVerdict: "correct", isCorrect: true }, 5000);
  assert.deepEqual(first.state.session.openAnswerPoints, {});
});

test("ending the exercise saves points per verdict and zero for everyone else", () => {
  let state = openedRoom();
  const ada = answer(state, "ada", "apple", 4000);
  const bo = answer(ada.state, "bo", "pear", 4100);
  state = bo.state;
  applyRoomJob(state, ada.jobs[0], { ok: true, analysis: "", answerVerdict: "correct", isCorrect: true }, 5000);
  applyRoomJob(state, bo.jobs[0], { ok: true, analysis: "", answerVerdict: "partial", isCorrect: false }, 5000);
  const ended = host(state, "end_room_exercise", { exerciseId: 9, exerciseType: "openanswer" }, 9000);
  assert.equal(ended.ack.ok, true);
  assert.equal(ended.state.open, null);
  const batch = ended.state.pendingScores[0];
  assert.equal(batch.exerciseType, "openanswer");
  assert.deepEqual(
    batch.scores.map((item) => [item.studentUserId, item.score]),
    [["ada", 300], ["bo", 150], ["cy", 0]]
  );
  assert.deepEqual(ended.state.session.openAnswerPoints, {});
});

test("points add up over the questions of one exercise", () => {
  let state = openedRoom();
  const q1 = answer(state, "ada", "apple", 4000);
  state = q1.state;
  applyRoomJob(state, q1.jobs[0], { ok: true, analysis: "", answerVerdict: "correct", isCorrect: true }, 5000);
  state = host(state, "next_openanswer_question", {}, 6000, NO_MODEL).state;
  state = host(state, "open_openanswer_window", {}, 7000, NO_MODEL).state;
  const q2 = answer(state, "ada", "blue", 8000);
  state = q2.state;
  applyRoomJob(state, q2.jobs[0], { ok: true, analysis: "", answerVerdict: "partial", isCorrect: false }, 9000);
  assert.equal(state.session.openAnswerPoints.ada.points, 450);
});

test("closing the session still saves points earned so far", () => {
  const first = answer(openedRoom(), "ada", "apple", 4000);
  applyRoomJob(first.state, first.jobs[0], { ok: true, analysis: "", answerVerdict: "correct", isCorrect: true }, 5000);
  const gone = { ...first.state, sockets: {}, timer: { kind: "host-grace", at: 1 } };
  const away = applyRoomTimer(gone, 10, SPEECH);
  assert.equal(away.state.open, null);
  assert.equal(away.state.pendingScores[0].scores.find((item) => item.studentUserId === "ada").score, 300);
});

test("starting the next exercise drops the round", () => {
  const state = openedRoom();
  const next = host(state, "start_next_exercise", { exercise: { id: 10, type: "video", items: [] } }, 9000);
  assert.equal(next.state.open, null);
});

test("a host who comes back during the answer window gets the clock back", () => {
  let state = openedRoom();
  state.timer = { kind: "host-grace", at: 60000 };
  const back = applyRoomEvent(state, { event: "host_session", data: {} }, {
    socketId: "host-2",
    role: null,
    now: 6000,
    caps: SPEECH,
  });
  assert.deepEqual(back.state.timer, { kind: "open", at: 23000 });
});

function createRoomWith() {
  const state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "5A" }, now: 1000 });
  state.sockets = { "host-1": { role: "host", playerId: null } };
  state.session.exercise = {
    id: 9,
    type: "openanswer",
    items: [{ topic: "Name a fruit", correctAnswer: "apple", timeLimit: 20 }, { topic: "Name a colour" }],
  };
  state.session.participants = [
    { userId: "ada", displayName: "Ada", online: true, joinedAt: 1 },
    { userId: "bo", displayName: "Bo", online: true, joinedAt: 2 },
    { userId: "cy", displayName: "Cy", online: true, joinedAt: 3 },
  ];
  return state;
}
