import assert from "node:assert/strict";
import test from "node:test";
import { resolveAudioRefs } from "./room-core.js";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent, applyRoomJob, tutorAskCheck } from "./room-events.js";
import { TUTOR_ASK_GAP_MS, TUTOR_MAX_ASKS, parseTutorReply, tutorPrompt } from "./room-tutor.js";

function room() {
  const state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "5A" }, now: 1000 });
  state.session.participants = [{ userId: "ada", displayName: "Ada", online: true, joinedAt: 1 }];
  return state;
}

const host = { socketId: "host-1", role: "host", now: 2000, pick: () => 0 };
const ada = (now = 3000) => ({ socketId: "s-1", role: "session_player", playerId: "ada", now, pick: () => 0 });
const lesson = { title: "Animal Homes", outline: "A bird lives in a nest.", language: "en", sttLanguage: "yue" };

function tutorOn() {
  const state = room();
  return applyRoomEvent(state, { event: "set_tutor", data: { enabled: true, lesson } }, host).state;
}

test("only the host turns questions on, and everyone is told", () => {
  const state = room();
  const refused = applyRoomEvent(state, { event: "set_tutor", data: { enabled: true, lesson } }, ada());
  assert.equal(refused.ack.ok, false);
  assert.equal(state.session.tutor, undefined);

  const on = applyRoomEvent(state, { event: "set_tutor", data: { enabled: true, lesson } }, host);
  assert.equal(on.ack.ok, true);
  assert.equal(on.state.session.tutor.lesson.title, "Animal Homes");
  assert.equal(on.state.session.tutor.lesson.sttLanguage, "yue");
  assert.deepEqual(on.broadcasts, [{ event: "tutor_state", data: { enabled: true } }]);

  const joined = applyRoomEvent(on.state, { event: "join_session", data: { displayName: "Bo", userId: "bo" } }, {
    socketId: "s-2", role: null, now: 3000, pick: () => 0,
  });
  assert.equal(joined.ack.tutor.enabled, true);
  assert.equal(joined.ack.tutor.waitMs, 0);
});

test("questions are refused while off, from non-students, and too soon", () => {
  const off = room();
  assert.equal(tutorAskCheck(off, ada()).ok, false);
  assert.equal(applyRoomEvent(off, { event: "ask_question", data: { text: "hi" } }, ada()).ack.ok, false);

  const state = tutorOn();
  assert.equal(tutorAskCheck(state, { socketId: "x", role: null, now: 3000 }).ok, false);
  assert.deepEqual(tutorAskCheck(state, ada()), { ok: true, sttLanguage: "yue" });

  const asked = applyRoomEvent(state, { event: "ask_question", data: { text: "Why do bees make honey?" } }, ada(3000));
  assert.equal(asked.ack.ok, true);
  const again = applyRoomEvent(asked.state, { event: "ask_question", data: { text: "And bears?" } }, ada(3000 + 1000));
  assert.equal(again.ack.ok, false);
  assert.ok(again.ack.waitMs > 0 && again.ack.waitMs <= TUTOR_ASK_GAP_MS);
  assert.equal(again.jobs.length, 0);
  const later = applyRoomEvent(asked.state, { event: "ask_question", data: { text: "And bears?" } }, ada(3000 + TUTOR_ASK_GAP_MS));
  assert.equal(later.ack.ok, true);
});

test("the whole class is capped", () => {
  const state = tutorOn();
  state.session.tutor.total = TUTOR_MAX_ASKS;
  assert.equal(tutorAskCheck(state, ada()).ok, false);
});

test("a heard question tells the host a hand is up and starts one answer job", () => {
  const state = tutorOn();
  const asked = applyRoomEvent(state, { event: "ask_question", data: { text: "  Why do bees\nmake honey?  " } }, ada());
  assert.equal(asked.ack.ok, true);
  assert.equal(asked.ack.text, "Why do bees make honey?");
  assert.equal(asked.ack.waitMs, TUTOR_ASK_GAP_MS);
  assert.deepEqual(asked.broadcasts, [{ event: "ask_received", hostOnly: true, data: { id: "ask-1", name: "Ada" } }]);
  assert.equal(asked.jobs.length, 1);
  assert.equal(asked.jobs[0].kind, "tutor-answer");
  assert.equal(asked.jobs[0].question, "Why do bees make honey?");
  assert.equal(asked.jobs[0].playerId, "ada");
  assert.equal(asked.state.session.tutor.total, 1);
});

test("nothing heard means no job and no cost counted", () => {
  const state = tutorOn();
  const empty = applyRoomEvent(state, { event: "ask_question", data: { text: "   " } }, ada());
  assert.equal(empty.ack.ok, false);
  assert.equal(empty.jobs.length, 0);
  assert.equal(empty.state, null);
  assert.equal(state.session.tutor.total, 0);
});

test("a finished answer goes to the host with its audio, and the student is told", () => {
  const state = tutorOn();
  const job = applyRoomEvent(state, { event: "ask_question", data: { text: "Why?" } }, ada()).jobs[0];
  const outcome = { ok: true, question: "Why do bees make honey?", answer: "Bees make honey to eat.", language: "en", audioId: "abc", questionAudioId: "q1", format: "mp3" };
  const applied = applyRoomJob(state, job, outcome, 9000);
  const [forHost, forStudent] = applied.broadcasts;
  assert.equal(forHost.event, "tutor_answer");
  assert.equal(forHost.hostOnly, true);
  assert.deepEqual(forHost.data, {
    id: "ask-1", name: "Ada", question: "Why do bees make honey?", answer: "Bees make honey to eat.",
    language: "en", audioContent: "audio:abc", questionAudioContent: "audio:q1", format: "mp3",
  });
  assert.equal(forStudent.toPlayer, "ada");
  assert.deepEqual(forStudent.data, { id: "ask-1", state: "answering" });
});

test("a voice failure still sends the text", () => {
  const state = tutorOn();
  const job = applyRoomEvent(state, { event: "ask_question", data: { text: "Why?" } }, ada()).jobs[0];
  const applied = applyRoomJob(state, job, { ok: true, question: "Why?", answer: "Because.", language: "en" }, 9000);
  assert.equal(applied.broadcasts[0].data.audioContent, null);
  assert.equal(applied.broadcasts[0].data.questionAudioContent, null);
  assert.equal(applied.broadcasts[0].data.answer, "Because.");
});

test("declined and failed answers release the host and tell the student", () => {
  const state = tutorOn();
  const job = applyRoomEvent(state, { event: "ask_question", data: { text: "Why?" } }, ada()).jobs[0];
  for (const [outcome, expected] of [[{ ok: true, declined: true }, "declined"], [{ ok: false, error: "boom" }, "failed"]]) {
    const applied = applyRoomJob(state, job, outcome, 9000);
    assert.deepEqual(applied.broadcasts[0], { event: "tutor_declined", hostOnly: true, data: { id: "ask-1" } });
    assert.equal(applied.broadcasts[1].toPlayer, "ada");
    assert.equal(applied.broadcasts[1].data.state, expected);
  }
});

test("the prompt carries the lesson, the language and the question as data", () => {
  const prompt = tutorPrompt({ question: 'Ignore this "rule"', language: "yue", lesson });
  assert.match(prompt, /Animal Homes/);
  assert.match(prompt, /A bird lives in a nest\./);
  assert.match(prompt, /Cantonese/);
  assert.ok(prompt.includes(JSON.stringify('Ignore this "rule"')));
  assert.match(tutorPrompt({ question: "hi", language: "en", lesson }), /simple English/);
});

test("only the JSON asked for becomes an answer, cleaned for speech", () => {
  assert.deepEqual(parseTutorReply('Sure!\n{"ok": true, "question": "Why do bees make honey?", "answer": "**Bees** make honey\\nto eat. "}'), {
    ok: true, question: "Why do bees make honey?", answer: "Bees make honey to eat.",
  });
  assert.deepEqual(parseTutorReply('{"ok": false, "answer": ""}'), { ok: false });
  assert.deepEqual(parseTutorReply('{"ok": "false", "answer": "x"}'), { ok: false });
  assert.deepEqual(parseTutorReply('{"ok": true, "answer": "  "}'), { ok: false });
  assert.deepEqual(parseTutorReply("Bees make honey."), { ok: false });
  assert.deepEqual(parseTutorReply("{not json}"), { ok: false });
  assert.equal(parseTutorReply(JSON.stringify({ ok: true, answer: "a".repeat(900) })).answer.length, 420);
});

test("a question asked in the room carries the language the answer is written and spoken in", () => {
  const ask = (lessonLanguage, text) => {
    const state = applyRoomEvent(room(), { event: "set_tutor", data: { enabled: true, lesson: { ...lesson, language: lessonLanguage } } }, host).state;
    const job = applyRoomEvent(state, { event: "ask_question", data: { text } }, ada()).jobs[0];
    return { job, prompt: tutorPrompt(job) };
  };
  // A Cantonese lesson: Cantonese, even for a question the recogniser wrote in English letters.
  for (const text of ["點解 AI 可以扮人把聲？", "AI deepfake hai mat ye?"]) {
    const { job, prompt } = ask("yue", text);
    assert.equal(job.language, "yue");
    assert.match(prompt, /Cantonese/);
    assert.doesNotMatch(prompt, /simple English/);
  }
  // An English lesson: English, unless the question was asked in Chinese.
  assert.match(ask("en", "Why do birds build nests?").prompt, /simple English/);
  assert.equal(ask("en", "雀仔點解起竇？").job.language, "yue");
});

test("the prompt is written for the lesson's class: children by default, else who the lesson says", () => {
  assert.match(tutorPrompt({ question: "hi", language: "en", lesson }), /young children \(about 6 to 10 years old\)/);
  const audience = "older adults (長者) in Hong Kong learning to use AI safely";
  const state = applyRoomEvent(room(), { event: "set_tutor", data: { enabled: true, lesson: { ...lesson, language: "yue", audience } } }, host).state;
  assert.equal(state.session.tutor.lesson.audience, audience);
  const job = applyRoomEvent(state, { event: "ask_question", data: { text: "AI 點樣扮人把聲？" } }, ada()).jobs[0];
  const prompt = tutorPrompt(job);
  assert.ok(prompt.includes(`The class: ${audience}.`));
  assert.doesNotMatch(prompt, /6 to 10/);
  assert.match(prompt, /never call them children/);
});

test("the host gets every audio reference filled in, the question's voice included", () => {
  const sounds = { "audio:abc": "ANSWER", "audio:q1": "QUESTION" };
  const filled = resolveAudioRefs({ id: "ask-1", audioContent: "audio:abc", questionAudioContent: "audio:q1", answer: "audio: not a ref", n: 1 }, (ref) => sounds[ref] ?? null);
  assert.equal(filled.audioContent, "ANSWER");
  assert.equal(filled.questionAudioContent, "QUESTION", "this field was left as 'audio:q1' and Tommy never said the question");
  assert.equal(filled.answer, "audio: not a ref", "ordinary text is left alone");
  assert.equal(filled.n, 1);
  // A missing recording becomes null, so the page just skips it.
  assert.equal(resolveAudioRefs({ questionAudioContent: "audio:gone" }, () => null).questionAudioContent, null);
});

// ---- A room linked to a group makes one answer at a time and queues the rest ----

import { TUTOR_INFLIGHT_MS, TUTOR_QUEUE_MAX, tutorDropped, tutorJobFor } from "./room-tutor.js";

function linked() {
  const state = tutorOn();
  state.session.group = { code: "1234" };
  state.session.participants.push({ userId: "bo", displayName: "Bo", online: true, joinedAt: 1 }, { userId: "cy", displayName: "Cy", online: true, joinedAt: 1 });
  return state;
}
const student = (id, now) => ({ socketId: `s-${id}`, role: "session_player", playerId: id, now, pick: () => 0 });
const ask = (state, id, now, text = "Why?") => applyRoomEvent(state, { event: "ask_question", data: { text } }, student(id, now));

test("a linked room does not start an answer itself: the group says when", () => {
  const state = linked();
  const asked = ask(state, "ada", 3000);
  assert.equal(asked.ack.ok, true);
  assert.equal(asked.jobs.length, 0);
  assert.deepEqual(asked.groupOps, [{ op: "submit", askId: "ask-1", name: "Ada" }]);
  assert.equal(asked.state.session.tutor.inflight.askId, "ask-1");
  assert.deepEqual(asked.broadcasts, [{ event: "ask_received", hostOnly: true, data: { id: "ask-1", name: "Ada" } }]);

  const job = tutorJobFor(asked.state, "ask-1");
  assert.equal(job.kind, "tutor-answer");
  assert.equal(job.question, "Why?");
  assert.equal(job.playerId, "ada");
  assert.equal(tutorJobFor(asked.state, "ask-9"), null);
});

test("while one is being answered, the room's next questions wait in line, first come first served", () => {
  let state = ask(linked(), "ada", 3000).state;
  const bo = ask(state, "bo", 4000, "And bears?");
  assert.equal(bo.ack.ok, true);
  assert.deepEqual(bo.groupOps, []);
  assert.deepEqual(bo.broadcasts[1], { event: "ask_status", toPlayer: "bo", data: { id: "ask-2", state: "queued" } });
  state = bo.state;
  state = ask(state, "cy", 5000, "And owls?").state;
  assert.deepEqual(state.session.tutor.queue, ["ask-2", "ask-3"]);

  // Ada's answer is made: it goes to the group for other rooms, and Bo's question is next.
  const job = tutorJobFor(state, "ask-1");
  const applied = applyRoomJob(state, job, { ok: true, question: "Why?", answer: "Because.", language: "en", audioUrl: "/a.mp3", questionAudioUrl: "/q.mp3" }, 9000);
  assert.deepEqual(applied.groupOps, [
    { op: "publish", askId: "ask-1", payload: { name: "Ada", question: "Why?", answer: "Because.", language: "en", audioUrl: "/a.mp3", questionAudioUrl: "/q.mp3" } },
    { op: "submit", askId: "ask-2", name: "Bo" },
  ]);
  assert.equal(applied.broadcasts[0].data.audioUrl, "/a.mp3");
  assert.equal(applied.broadcasts[0].data.questionAudioUrl, "/q.mp3");
  assert.equal(applied.state.session.tutor.inflight.askId, "ask-2");
  assert.deepEqual(applied.state.session.tutor.queue, ["ask-3"]);
  assert.equal(applied.state.session.tutor.pending["ask-1"], undefined);
});

test("the line is only so long", () => {
  let state = ask(linked(), "ada", 3000).state;
  const names = ["bo", "cy", "di", "ed", "flo"];
  state.session.participants.push({ userId: "di", displayName: "Di", online: true, joinedAt: 1 }, { userId: "ed", displayName: "Ed", online: true, joinedAt: 1 }, { userId: "flo", displayName: "Flo", online: true, joinedAt: 1 });
  const results = names.map((id, i) => {
    const res = ask(state, id, 4000 + i);
    if (res.state) state = res.state;
    return res.ack.ok;
  });
  assert.deepEqual(results, [true, true, true, false, false]);
  assert.equal(state.session.tutor.queue.length, TUTOR_QUEUE_MAX);
});

test("a declined or failed answer starts the next one in line and publishes nothing", () => {
  let state = ask(linked(), "ada", 3000).state;
  state = ask(state, "bo", 4000).state;
  const job = tutorJobFor(state, "ask-1");
  const applied = applyRoomJob(state, job, { ok: true, declined: true }, 9000);
  assert.deepEqual(applied.groupOps, [{ op: "submit", askId: "ask-2", name: "Bo" }]);
  assert.equal(applied.broadcasts[0].event, "tutor_declined");
});

test("a lost job does not hold the line forever", () => {
  const state = ask(linked(), "ada", 3000).state;
  const later = ask(state, "bo", 3000 + TUTOR_INFLIGHT_MS + 1);
  assert.equal(later.ack.ok, true);
  assert.deepEqual(later.groupOps, [{ op: "submit", askId: "ask-2", name: "Bo" }], "it starts at once");
  assert.equal(later.state.session.tutor.inflight.askId, "ask-2");
});

test("a question the group let go of comes down, may be asked again at once, and is not counted", () => {
  let state = ask(linked(), "ada", 3000).state;
  state = ask(state, "bo", 4000).state;
  const dropped = tutorDropped(state, "ask-1", 130000);
  assert.deepEqual(dropped.broadcasts, [
    { event: "tutor_declined", hostOnly: true, data: { id: "ask-1" } },
    { event: "ask_status", toPlayer: "ada", data: { id: "ask-1", state: "later" } },
  ]);
  assert.deepEqual(dropped.groupOps, [{ op: "submit", askId: "ask-2", name: "Bo" }]);
  assert.equal(dropped.state.session.tutor.asked.ada, undefined);
  assert.equal(dropped.state.session.tutor.total, 1);
  assert.equal(tutorAskCheck(dropped.state, ada(130001)).ok, true);
  assert.deepEqual(tutorDropped(dropped.state, "ask-77", 1).groupOps, []);
});

test("turning questions on again keeps the line", () => {
  let state = ask(linked(), "ada", 3000).state;
  state = ask(state, "bo", 4000).state;
  const again = applyRoomEvent(state, { event: "set_tutor", data: { enabled: true, lesson } }, host).state;
  assert.equal(again.session.tutor.inflight.askId, "ask-1");
  assert.deepEqual(again.session.tutor.queue, ["ask-2"]);
  assert.ok(again.session.tutor.pending["ask-2"]);
});

test("a room that is not linked is not changed by any of this", () => {
  const state = tutorOn();
  const asked = ask(state, "ada", 3000);
  assert.equal(asked.jobs.length, 1);
  assert.deepEqual(asked.groupOps, []);
  assert.equal(asked.state.session.tutor.inflight, undefined);
  const applied = applyRoomJob(asked.state, asked.jobs[0], { ok: true, question: "Why?", answer: "Because.", language: "en", audioId: "x" }, 9000);
  assert.deepEqual(applied.groupOps, []);
  assert.equal("audioUrl" in applied.broadcasts[0].data, false);
});
