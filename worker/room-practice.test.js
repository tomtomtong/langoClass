// "Say it with me" practice on the autoclass page: Everyone Answers with exercise.practice.
import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent, applyRoomTimer, openAnswerSubmitCheck } from "./room-events.js";
import { practiceVerdict } from "./room-open-answer.js";

const SPEECH = { speech: true, text: true };
const SENTENCE = "A bird lives in a nest.";

function room() {
  const state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "5A" }, now: 1000 });
  state.sockets = { "host-1": { role: "host", playerId: null } };
  state.session.exercise = {
    id: "autoclass-animal-homes-say1",
    type: "openanswer",
    practice: true,
    items: [{ topic: SENTENCE, correctAnswer: SENTENCE, sttLanguage: "en", timeLimit: 15 }],
  };
  state.session.participants = [
    { userId: "ada", displayName: "Ada", online: true, joinedAt: 1 },
    { userId: "bo", displayName: "Bo", online: true, joinedAt: 2 },
    { userId: "cy", displayName: "Cy", online: true, joinedAt: 3 },
  ];
  return state;
}

const host = (state, event, data, now) => applyRoomEvent(state, { event, data }, { socketId: "host-1", role: "host", now, pick: () => 0, caps: SPEECH });
const student = (state, playerId, data, now) =>
  applyRoomEvent(state, { event: "submit_openanswer_response", data }, { socketId: `${playerId}-s`, role: "session_player", playerId, now, pick: () => 0, caps: SPEECH });

function opened() {
  const started = host(room(), "start_openanswer_round", {}, 2000);
  return host(started.state, "open_openanswer_window", {}, 3000).state;
}

test("the sentence is not read aloud by the room: the video already said it", () => {
  const started = host(room(), "start_openanswer_round", {}, 2000);
  assert.equal(started.jobs.length, 0);
  assert.notEqual(started.deferAck, true);
  assert.equal(started.ack.ok, true);
  assert.equal(started.ack.practice, true);
  assert.equal(started.state.open.answerSeconds, 15);
});

test("the recording check tells the room not to keep the recording", () => {
  const check = openAnswerSubmitCheck(opened(), { role: "session_player", playerId: "ada", now: 4000 });
  assert.deepEqual(check, { ok: true, sttLanguage: "en", practice: true, warmup: false });
});

test("an answer is marked at once, with no model call and no points", () => {
  const sent = student(opened(), "ada", { text: "a bird lives in a nest", hadAudio: true }, 4000);
  assert.equal(sent.ack.ok, true);
  assert.equal(sent.jobs.length, 0, "no marking model");
  assert.equal(sent.ack.mine.practiceVerdict, "great");
  assert.equal(sent.ack.mine.points, 0);
  assert.equal(sent.ack.mine.analysisStatus, "done");
  assert.equal(sent.ack.mine.hasResponseAudio, false);
  const update = sent.broadcasts.find((frame) => frame.event === "openanswer_update");
  assert.equal(update.hostData.responses[0].practiceVerdict, "great");
  assert.equal(update.hostData.responses[0].responseAudio, null);
  assert.equal(update.data.responses, undefined, "the other phones see counts only");
  assert.deepEqual(sent.state.session.openAnswerPoints, {});
});

test("nothing heard, or a failed transcription, still counts as a go", () => {
  const sent = student(opened(), "bo", { text: "", hadAudio: true }, 4000);
  assert.equal(sent.ack.ok, true);
  assert.equal(sent.ack.mine.practiceVerdict, "tried");
  const empty = student(opened(), "bo", { text: "" }, 4000);
  assert.equal(empty.ack.ok, false, "but something must have been recorded");
});

test("the window closes as soon as everyone has had a go", () => {
  let state = opened();
  state = student(state, "ada", { text: "a bird lives in a nest", hadAudio: true }, 4000).state;
  state = student(state, "bo", { text: "bird nest", hadAudio: true }, 4100).state;
  const last = student(state, "cy", { text: "", hadAudio: true }, 4200);
  assert.equal(last.state.open.phase, "done");
  assert.equal(last.state.open.closeReason, "all");
  assert.ok(last.broadcasts.some((frame) => frame.event === "openanswer_closed"));
});

test("practice never saves scores, not even zeros", () => {
  let state = student(opened(), "ada", { text: SENTENCE, hadAudio: true }, 4000).state;
  assert.equal(state.session.openAnswerExerciseId, null);
  const next = host(state, "start_next_exercise", { exercise: { id: "watch", type: "video", items: [] } }, 5000);
  assert.deepEqual(next.state.pendingScores || [], []);

  state = student(opened(), "ada", { text: SENTENCE, hadAudio: true }, 4000).state;
  const ended = host(state, "end_room_exercise", { exerciseId: "autoclass-animal-homes-say1", exerciseType: "openanswer" }, 9000);
  assert.equal(ended.ack.ok, true);
  assert.deepEqual(ended.state.pendingScores || [], []);

  state = student(opened(), "ada", { text: SENTENCE, hadAudio: true }, 4000).state;
  const away = applyRoomTimer({ ...state, sockets: {}, timer: { kind: "host-grace", at: 1 } }, 10, SPEECH);
  assert.deepEqual(away.state.pendingScores || [], []);
});

test("a normal Everyone Answers round is unchanged: the topic is read and answers are marked", () => {
  const state = room();
  delete state.session.exercise.practice;
  const started = host(state, "start_openanswer_round", {}, 2000);
  assert.deepEqual(started.jobs.map((job) => job.kind), ["open-topic"]);
  const open = host(started.state, "open_openanswer_window", {}, 3000).state;
  assert.equal(openAnswerSubmitCheck(open, { role: "session_player", playerId: "ada", now: 4000 }).practice, false);
  const sent = student(open, "ada", { text: SENTENCE }, 4000);
  assert.deepEqual(sent.jobs.map((job) => job.kind), ["open-analyze"]);
  assert.equal(sent.ack.mine.practiceVerdict, null);
  assert.equal(open.session.openAnswerExerciseId, "autoclass-animal-homes-say1");
});

test("the verdict is kind: order, case, punctuation and a dropped plural do not matter", () => {
  assert.equal(practiceVerdict(SENTENCE, "A bird lives in a nest."), "great");
  assert.equal(practiceVerdict(SENTENCE, "a bird live in a nest"), "great", "dropped s");
  assert.equal(practiceVerdict(SENTENCE, "bird lives in nest"), "almost", "4 of 6 words");
  assert.equal(practiceVerdict(SENTENCE, "in a nest a bird lives"), "great", "any order");
  assert.equal(practiceVerdict(SENTENCE, "bird nest"), "tried", "2 of 6");
  assert.equal(practiceVerdict(SENTENCE, "the bird"), "tried");
  assert.equal(practiceVerdict(SENTENCE, ""), "tried");
  assert.equal(practiceVerdict("", "anything"), "tried");
  assert.equal(practiceVerdict(SENTENCE, "a a a a a a"), "tried", "repeating one word does not count for every place");
  assert.equal(practiceVerdict("A bee lives in a hive.", "a bee lives in a hive"), "great");
  assert.equal(practiceVerdict("Glass is clear.", "glass is clear"), "great", "a word ending in ss keeps it");
});

test("Chinese is compared character by character", () => {
  assert.equal(practiceVerdict("雀仔住喺雀巢", "雀仔住喺雀巢。"), "great");
  assert.equal(practiceVerdict("雀仔住喺雀巢", "雀仔住"), "almost");
  assert.equal(practiceVerdict("雀仔住喺雀巢", "你好"), "tried");
});

// A warm-up question on the autoclass page: an open question with exercise.warmup. Nobody is marked.
function warmupOpened() {
  const state = room();
  state.session.exercise = {
    id: "autoclass-animal-homes-ask1",
    type: "openanswer",
    autoclass: true,
    warmup: true,
    items: [{ topic: "Say good morning and your name!", correctAnswer: "Any answer is fine", sttLanguage: "en", timeLimit: 15 }],
  };
  const started = host(state, "start_openanswer_round", {}, 2000);
  return host(started.state, "open_openanswer_window", {}, 3000).state;
}

test("a warm-up answer is counted with no marking, no model call and no points", () => {
  assert.equal(openAnswerSubmitCheck(warmupOpened(), { role: "session_player", playerId: "ada", now: 4000 }).warmup, true);
  const sent = student(warmupOpened(), "ada", { text: "good morning I am Ada", hadAudio: true }, 4000);
  assert.equal(sent.ack.ok, true);
  assert.equal(sent.jobs.length, 0, "no marking model");
  assert.equal(sent.ack.mine.warmup, true);
  assert.equal(sent.ack.mine.answerVerdict, null);
  assert.equal(sent.ack.mine.points, 0);
  assert.equal(sent.ack.mine.analysisStatus, "done");
  assert.equal(sent.state.session.openAnswerExerciseId, null);
});

test("a warm-up still counts when nothing was heard, and closes when everyone has had a go", () => {
  let state = warmupOpened();
  state = student(state, "ada", { text: "", hadAudio: true }, 4000).state;
  state = student(state, "bo", { text: "hello", hadAudio: true }, 4100).state;
  const last = student(state, "cy", { text: "morning", hadAudio: true }, 4200);
  assert.equal(last.state.open.phase, "done");
  assert.equal(last.state.open.responses.length, 3);
  assert.equal(student(warmupOpened(), "bo", { text: "" }, 4000).ack.ok, false, "but something must have been recorded");
});
