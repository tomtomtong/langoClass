import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent, applyRoomJob, applyRoomTimer, buzzSubmitCheck } from "./room-events.js";

const SPEECH = { speech: true, text: true };

function buzzRoom(caps = SPEECH) {
  let state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "5A" }, now: 1000 });
  state.sockets = { "host-1": { role: "host", playerId: null } };
  state.session.exercise = {
    id: 7,
    type: "buzzin",
    items: [{ topic: "Name a fruit", correctAnswer: "apple" }, { topic: "Name a colour" }],
  };
  state.session.participants = [
    { userId: "ada", displayName: "Ada", online: true, joinedAt: 1 },
    { userId: "bo", displayName: "Bo", online: true, joinedAt: 2 },
  ];
  state = host(state, "start_buzzin_round", {}, 2000, caps).state;
  state = host(state, "open_buzzin_join", {}, 3000, caps).state;
  return state;
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

test("the first buzz calls the student up with a spoken announcement for the host only", () => {
  const buzzed = student(buzzRoom(), "ada", "buzz_in", {}, 3500);
  assert.equal(buzzed.ack.ok, true);
  assert.equal(buzzed.state.buzz.phase, "typing");
  assert.equal(buzzed.broadcasts[0].event, "buzzin_join_closed");
  assert.equal(buzzed.broadcasts[0].data.currentTurn.playerId, "ada");
  assert.equal(buzzed.broadcasts[0].data.correctAnswer, undefined);
  assert.equal(buzzed.broadcasts[0].hostData.correctAnswer, "apple");
  assert.deepEqual(buzzed.jobs.map((job) => job.kind), ["buzz-announce"]);
  assert.match(buzzed.jobs[0].text, /Name a fruit Ada, you're up!/);

  const announced = applyRoomJob(buzzed.state, buzzed.jobs[0], { audioId: "a1", format: "mp3" }, 4000);
  const frame = announced.broadcasts[0];
  assert.equal(frame.event, "buzzin_update");
  assert.equal(frame.hostData.answerAnnouncement.audio, "audio:a1");
  assert.equal(frame.data.answerAnnouncement.audio, null);
  assert.equal(frame.data.answerAnnouncement.displayName, "Ada");
});

test("a wrong answer offers one retry, and the second answer closes the turn", () => {
  let state = student(buzzRoom(), "ada", "buzz_in", {}, 3500).state;
  assert.equal(buzzSubmitCheck(state, { role: "session_player", playerId: "bo" }).ok, false);

  const first = student(state, "ada", "submit_buzzin_response", { text: "banana", responseAudioId: "r1", hadAudio: true }, 5000);
  assert.equal(first.ack.ok, true);
  assert.equal(first.state.buzz.responses[0].analysisStatus, "pending");
  assert.equal(first.ack.responses[0].responseAudio, null);
  assert.equal(first.ack.responses[0].hasResponseAudio, true);
  const job = first.jobs[0];
  assert.equal(job.kind, "buzz-analyze");
  assert.equal(job.correctAnswer, "apple");
  assert.equal(job.hasAudio, true);
  state = first.state;

  const again = student(state, "ada", "submit_buzzin_response", { text: "pear" }, 5100);
  assert.equal(again.ack.error, "Your answer is still being checked.");

  const marked = applyRoomJob(state, job, {
    ok: true,
    analysis: "✅ Correctness (20): Not the key",
    spokenFeedback: "Nice try, Ada!",
    answerVerdict: "incorrect",
    isCorrect: false,
    audioId: "f1",
    format: "mp3",
  }, 6000);
  state = marked.state;
  assert.equal(marked.broadcasts[0].event, "buzzin_response_analyzed");
  assert.equal(state.buzz.pendingRetryPlayerId, "ada");
  assert.equal(marked.broadcasts[0].data.canOfferRetry, true);
  assert.equal(marked.broadcasts[0].hostData.responses[0].analysisAudio, "audio:f1");
  assert.equal(marked.broadcasts[0].data.responses[0].analysisAudio, null);

  const blocked = student(state, "ada", "submit_buzzin_response", { text: "pear" }, 6100);
  assert.equal(blocked.ack.error, "Choose whether to try again first.");

  const retry = student(state, "ada", "buzzin_retry_choice", { accept: true }, 6200);
  assert.equal(retry.ack.ok, true);
  assert.equal(retry.state.buzz.retryActivePlayerId, "ada");
  state = retry.state;

  const second = student(state, "ada", "submit_buzzin_response", { text: "an apple" }, 7000);
  assert.equal(second.ack.ok, true);
  state = second.state;
  const final = applyRoomJob(state, second.jobs[0], { ok: true, analysis: "", spokenFeedback: "", answerVerdict: "incorrect", isCorrect: false }, 8000);
  assert.equal(final.state.buzz.phase, "done");
  assert.equal(final.state.buzz.pendingRetryPlayerId, null);
});

test("a correct answer closes the turn without a retry", () => {
  let state = student(buzzRoom(), "ada", "buzz_in", {}, 3500).state;
  const sent = student(state, "ada", "submit_buzzin_response", { text: "apple" }, 5000);
  const marked = applyRoomJob(sent.state, sent.jobs[0], { ok: true, analysis: "", spokenFeedback: "Great, Ada!", answerVerdict: "correct", isCorrect: true }, 6000);
  assert.equal(marked.state.buzz.phase, "done");
  assert.equal(marked.state.buzz.responses[0].isCorrect, true);
});

test("a failed marking call still offers the student another try", () => {
  let state = student(buzzRoom(), "ada", "buzz_in", {}, 3500).state;
  const sent = student(state, "ada", "submit_buzzin_response", { text: "apple" }, 5000);
  const failed = applyRoomJob(sent.state, sent.jobs[0], { ok: false, error: "LLM down" }, 6000);
  assert.equal(failed.state.buzz.responses[0].analysisStatus, "error");
  assert.equal(failed.state.buzz.responses[0].analysis, "LLM down");
  assert.equal(failed.state.buzz.pendingRetryPlayerId, "ada");
});

test("without a marking model the answer is kept and the turn ends", () => {
  const caps = { speech: false, text: false };
  let state = student(buzzRoom(caps), "ada", "buzz_in", {}, 3500, caps).state;
  assert.equal(state.buzz.answerAnnouncement.audio, null);
  const sent = student(state, "ada", "submit_buzzin_response", { text: "apple" }, 5000, caps);
  assert.equal(sent.jobs.length, 0);
  assert.equal(sent.state.buzz.phase, "done");
  assert.equal(sent.broadcasts[0].event, "buzzin_response_analyzed");
});

test("a marking result for an older round is ignored", () => {
  let state = student(buzzRoom(), "ada", "buzz_in", {}, 3500).state;
  const sent = student(state, "ada", "submit_buzzin_response", { text: "apple" }, 5000);
  state = host(sent.state, "next_buzzin_question", {}, 5500).state;
  const late = applyRoomJob(state, sent.jobs[0], { ok: true, analysis: "", spokenFeedback: "", isCorrect: true }, 6000);
  assert.equal(late.broadcasts.length, 0);
  assert.equal(late.state.buzz.topic, "Name a colour");
});

test("lucky draw answers the host after the announcement is spoken", () => {
  const drawn = host(buzzRoom(), "buzzin_lucky_draw", {}, 3500);
  assert.equal(drawn.deferAck, true);
  assert.equal(drawn.ack, undefined);
  assert.equal(drawn.state.buzz.phase, "typing");
  assert.equal(drawn.state.buzz.buzzes[0].playerId, "ada");
  const spoken = applyRoomJob(drawn.state, drawn.jobs[0], { audioId: "l1", format: "mp3" }, 4000);
  assert.equal(spoken.ack.ok, true);
  assert.equal(spoken.ack.winner.displayName, "Ada");
  assert.equal(spoken.ack.announcementAudio, "audio:l1");
  assert.match(spoken.ack.announcementText, /Ada, you're up!/);
  assert.equal(spoken.broadcasts[0].event, "buzzin_update");
});

function fastQuiz(caps = SPEECH) {
  let state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62 }, now: 1000 });
  state.session.participants = [{ userId: "ada", displayName: "Ada", online: true, joinedAt: 1 }];
  const created = applyRoomEvent(state, {
    event: "create_room_game",
    data: { quiz: { title: "Fast", fastMode: true, speakLangCode: "yue", questions: [{ text: "1+1", options: ["1", "2"], correctIndex: 1 }] } },
  }, { socketId: "host-1", role: null, now: 2000, pick: () => 0, caps });
  state = created.state;
  const started = host(state, "start_room_game", {}, 2000, caps);
  return applyRoomTimer(started.state, started.timer.at, caps);
}

test("a fast quiz question is read aloud on the host before answers open", () => {
  const speaking = fastQuiz();
  assert.equal(speaking.state.game.status, "speaking");
  assert.equal(speaking.broadcasts[0].event, "question_speaking");
  assert.equal(speaking.timer.kind, "speaking");
  const job = speaking.jobs[0];
  assert.equal(job.kind, "question-tts");
  assert.equal(job.language, "yue");

  const tts = applyRoomJob(speaking.state, job, { audioId: "q1", format: "mp3" }, 5000);
  assert.equal(tts.broadcasts[0].event, "question_tts");
  assert.equal(tts.broadcasts[0].hostOnly, true);
  assert.equal(tts.broadcasts[0].data.audioContent, "audio:q1");
  assert.equal(tts.state.game.status, "speaking");

  const opened = host(tts.state, "question_tts_done", { questionIndex: 0 }, 9000);
  assert.equal(opened.state.game.status, "question");
  assert.equal(opened.broadcasts[0].event, "question_start");
});

test("a fast quiz question opens when its speech fails or never finishes", () => {
  const speaking = fastQuiz();
  const failed = applyRoomJob(speaking.state, speaking.jobs[0], { ok: false }, 5000);
  assert.equal(failed.state.game.status, "question");

  const pending = fastQuiz();
  assert.equal(pending.timer.at - 4000, 45000);
  const waited = applyRoomTimer(pending.state, pending.timer.at, SPEECH);
  assert.equal(waited.state.game.status, "question");

  const silent = fastQuiz({ speech: false, text: false });
  assert.equal(silent.state.game.status, "question");
});

test("finished exercises ask the room for the semester leaderboard", () => {
  let state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62 }, now: 1000 });
  state.session.exercise = { id: 7, type: "buzzin", items: [{ topic: "Hi" }] };
  const ended = host(state, "end_room_exercise", { exerciseId: 7 }, 2000);
  assert.equal(ended.ackSemester, true);
  assert.equal(ended.broadcasts.find((frame) => frame.event === "room_exercise_wrap_up").semester, true);
});
