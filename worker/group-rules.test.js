import assert from "node:assert/strict";
import test from "node:test";
import {
  ANSWER_KEEP_MS,
  ANSWER_TTL_MS,
  GROUP_LIFETIME_MS,
  GROUP_MAX_ROOMS,
  QUEUE_TTL_MS,
  RATE_WINDOW_MS,
  STT_PER_MIN,
  allowStt,
  drainWaiting,
  giveBackStart,
  groupCode,
  groupExpired,
  joinGroup,
  leaveGroup,
  memberCount,
  newGroup,
  pickAnswer,
  pruneGroup,
  publishAnswer,
  submitAsk,
} from "./group-rules.js";

const T0 = 1_000_000_000_000;
const make = (extra = {}) => newGroup({ code: "1234", lessonId: "animal-homes", lessonTitle: "Animal Homes", rate: 2, now: T0, ...extra });
const answer = (askId, roomId, extra = {}) => ({ askId, roomId, name: "Ada", question: "Why?", answer: "Because.", language: "en", ...extra });

test("a group code is four digits", () => {
  assert.equal(groupCode(" 1234 "), "1234");
  assert.equal(groupCode(1234), "1234");
  for (const bad of ["123", "12345", "abcd", "", null, undefined, "12 34"]) assert.equal(groupCode(bad), "");
});

test("rooms join a group of the same lesson, again harmlessly, and leave", () => {
  const group = make();
  assert.deepEqual(joinGroup(group, { roomId: "r1", lessonId: "animal-homes" }, T0), { ok: true, members: 1, lessonTitle: "Animal Homes" });
  assert.equal(joinGroup(group, { roomId: "r1", lessonId: "animal-homes" }, T0).members, 1, "joining twice is one room");
  assert.equal(joinGroup(group, { roomId: "r2", lessonId: "animal-homes" }, T0).members, 2);
  const other = joinGroup(group, { roomId: "r3", lessonId: "other-lesson" }, T0);
  assert.equal(other.ok, false);
  assert.match(other.error, /another lesson/);
  assert.equal(memberCount(group), 2);
  assert.equal(joinGroup(group, { roomId: "", lessonId: "animal-homes" }, T0).ok, false);

  assert.deepEqual(leaveGroup(group, "r1", T0), { empty: false });
  assert.deepEqual(leaveGroup(group, "r2", T0), { empty: true });
});

test("a group holds at most 100 rooms, but a room already in can always join again", () => {
  const group = make();
  for (let i = 0; i < GROUP_MAX_ROOMS; i += 1) assert.equal(joinGroup(group, { roomId: `r${i}`, lessonId: "animal-homes" }, T0).ok, true);
  const full = joinGroup(group, { roomId: "late", lessonId: "animal-homes" }, T0);
  assert.equal(full.ok, false);
  assert.match(full.error, /full/);
  assert.equal(joinGroup(group, { roomId: "r5", lessonId: "animal-homes" }, T0).ok, true);
});

test("leaving takes a room's waiting questions with it", () => {
  const group = make({ rate: 1 });
  submitAsk(group, { roomId: "r1", askId: "a1", name: "Ada" }, T0);
  submitAsk(group, { roomId: "r2", askId: "b1", name: "Bo" }, T0 + 1);
  submitAsk(group, { roomId: "r3", askId: "c1", name: "Cy" }, T0 + 2);
  assert.deepEqual(group.waiting.map((item) => item.askId), ["b1", "c1"]);
  leaveGroup(group, "r2", T0 + 3);
  assert.deepEqual(group.waiting.map((item) => item.askId), ["c1"]);
});

test("recordings are turned into text only so fast", () => {
  const group = make();
  for (let i = 0; i < STT_PER_MIN; i += 1) assert.equal(allowStt(group, T0), true, `recording ${i + 1}`);
  assert.equal(allowStt(group, T0 + 1000), false);
  assert.equal(allowStt(group, T0 + RATE_WINDOW_MS * 2), true, "two minutes later the count is fresh");
  const small = make();
  assert.equal(allowStt(small, T0, 1), true);
  assert.equal(allowStt(small, T0, 1), false);
});

test("answers start at once up to the rate, then wait their turn", () => {
  const group = make({ rate: 2 });
  assert.deepEqual(submitAsk(group, { roomId: "r1", askId: "a1", name: "Ada" }, T0), { start: true });
  assert.deepEqual(submitAsk(group, { roomId: "r2", askId: "b1", name: "Bo" }, T0 + 10), { start: true });
  assert.deepEqual(submitAsk(group, { roomId: "r3", askId: "c1", name: "Cy" }, T0 + 20), { queued: true, position: 1 });
  assert.deepEqual(submitAsk(group, { roomId: "r4", askId: "d1", name: "Di" }, T0 + 30), { queued: true, position: 2 });
  // Nobody jumps the line, even when a slot is free: the ones waiting go first.
  const later = T0 + RATE_WINDOW_MS + 5;
  assert.deepEqual(submitAsk(group, { roomId: "r5", askId: "e1", name: "Ed" }, later), { queued: true, position: 3 });
});

test("waiting questions start first come first served when slots free up", () => {
  const group = make({ rate: 2 });
  submitAsk(group, { roomId: "r1", askId: "a1" }, T0);
  submitAsk(group, { roomId: "r2", askId: "b1" }, T0 + 10);
  submitAsk(group, { roomId: "r3", askId: "c1" }, T0 + 20);
  submitAsk(group, { roomId: "r4", askId: "d1" }, T0 + 30);

  const now = drainWaiting(group, T0 + 1000);
  assert.deepEqual(now.start, []);
  assert.equal(now.nextDue, T0 + RATE_WINDOW_MS, "when the first start leaves the minute");

  const freed = drainWaiting(group, T0 + RATE_WINDOW_MS + 1);
  assert.deepEqual(freed.start.map((item) => item.askId), ["c1"], "one slot is free: the first start left the minute");
  const rest = drainWaiting(group, T0 + RATE_WINDOW_MS + 11);
  assert.deepEqual(rest.start.map((item) => item.askId), ["d1"]);
  assert.equal(rest.nextDue, null);
});

test("a question that waits too long is dropped, not answered late", () => {
  const group = make({ rate: 1 });
  submitAsk(group, { roomId: "r1", askId: "a1" }, T0);
  submitAsk(group, { roomId: "r2", askId: "b1" }, T0 + 1);
  submitAsk(group, { roomId: "r3", askId: "c1" }, T0 + 2);
  const first = drainWaiting(group, T0 + RATE_WINDOW_MS + 1);
  assert.deepEqual(first.start.map((item) => item.askId), ["b1"]);
  assert.deepEqual(first.expired, []);
  assert.equal(first.nextDue, T0 + QUEUE_TTL_MS + 1, "when the next slot frees, just before c1 would run out of time");
  // If nobody looked until its time was up, it is let go instead.
  const late = drainWaiting(group, T0 + QUEUE_TTL_MS + 2);
  assert.deepEqual(late.expired.map((item) => item.askId), ["c1"]);
  assert.deepEqual(late.start, []);
  assert.equal(group.waiting.length, 0);
});

test("a start that could not happen gives its slot back", () => {
  const group = make({ rate: 1 });
  assert.deepEqual(submitAsk(group, { roomId: "r1", askId: "a1" }, T0), { start: true });
  giveBackStart(group, T0 + 1);
  assert.deepEqual(submitAsk(group, { roomId: "r2", askId: "b1" }, T0 + 2), { start: true });
});

test("a room is given another room's answer, never its own, never twice", () => {
  const group = make();
  publishAnswer(group, answer("a1", "r1"), T0);
  publishAnswer(group, answer("b1", "r2"), T0 + 1);
  const picks = [];
  for (let i = 0; i < 3; i += 1) picks.push(pickAnswer(group, "r3", T0 + 100, () => 0));
  assert.deepEqual(picks.map((item) => item?.askId ?? null).sort(), [null, "r1:a1", "r2:b1"]);
  assert.equal(pickAnswer(group, "r1", T0 + 100, () => 0).askId, "r2:b1", "never its own");
  assert.equal(pickAnswer(group, "r1", T0 + 100, () => 0), null, "and not again");
  assert.equal(pickAnswer(group, "r9", T0 + 100, () => 0).roomId !== "r9", true);
});

test("the answer fewest rooms have been given comes first, so each finds an audience", () => {
  const group = make();
  publishAnswer(group, answer("a1", "r1"), T0);
  publishAnswer(group, answer("b1", "r2"), T0);
  const seen = { a1: 0, b1: 0 };
  for (let i = 3; i < 13; i += 1) seen[pickAnswer(group, `r${i}`, T0 + 10, () => 0).askId.split(":")[1]] += 1;
  assert.deepEqual(seen, { a1: 5, b1: 5 });
  // Among answers watched equally often the choice is random.
  const fresh = make();
  publishAnswer(fresh, answer("a1", "r1"), T0);
  publishAnswer(fresh, answer("b1", "r2"), T0);
  assert.equal(pickAnswer(fresh, "r3", T0, () => 1).askId, "r2:b1");
});

test("an answer is only picked while it is fresh", () => {
  const group = make();
  publishAnswer(group, answer("a1", "r1"), T0);
  assert.equal(pickAnswer(group, "r2", T0 + ANSWER_TTL_MS - 1, () => 0).askId, "r1:a1");
  assert.equal(pickAnswer(group, "r3", T0 + ANSWER_TTL_MS, () => 0), null);
  assert.equal(pickAnswer(make(), "r1", T0), null, "nothing published yet");
});

test("publishing the same question again replaces it, and the answer is kept as given", () => {
  const group = make();
  publishAnswer(group, answer("a1", "r1", { answer: "First." }), T0);
  publishAnswer(group, answer("a1", "r1", { answer: "Second.", audioUrl: "/x.mp3", questionAudioUrl: "/q.mp3" }), T0 + 1);
  assert.equal(group.answers.length, 1);
  const picked = pickAnswer(group, "r2", T0 + 2, () => 0);
  assert.equal(picked.answer, "Second.");
  assert.equal(picked.audioUrl, "/x.mp3");
  assert.equal(picked.questionAudioUrl, "/q.mp3");
});

test("rooms number their questions alike: the same askId in two rooms is two different questions", () => {
  const group = make({ rate: 1 });
  submitAsk(group, { roomId: "r1", askId: "ask-1" }, T0);
  submitAsk(group, { roomId: "r2", askId: "ask-1" }, T0 + 1);
  submitAsk(group, { roomId: "r3", askId: "ask-1" }, T0 + 2);
  assert.deepEqual(group.waiting.map((item) => item.roomId), ["r2", "r3"], "one does not replace another");

  publishAnswer(group, answer("ask-1", "r1"), T0);
  publishAnswer(group, answer("ask-1", "r2"), T0);
  assert.equal(group.answers.length, 2);
  const first = pickAnswer(group, "r3", T0 + 1, () => 0);
  const second = pickAnswer(group, "r3", T0 + 1, () => 0);
  assert.deepEqual([first.askId, second.askId].sort(), ["r1:ask-1", "r2:ask-1"]);
  assert.equal(pickAnswer(group, "r3", T0 + 1, () => 0), null);
});

test("pruning drops old answers and what refers to them", () => {
  const group = make();
  publishAnswer(group, answer("old", "r1"), T0);
  publishAnswer(group, answer("new", "r2"), T0 + ANSWER_KEEP_MS);
  pickAnswer(group, "r3", T0 + 1000, () => 0);
  assert.deepEqual(group.delivered, { r3: ["r1:old"] });
  pruneGroup(group, T0 + ANSWER_KEEP_MS + 1);
  assert.deepEqual(group.answers.map((item) => item.askId), ["new"]);
  assert.deepEqual(group.delivered, {});
  allowStt(group, T0);
  pruneGroup(group, T0 + RATE_WINDOW_MS * 5);
  assert.deepEqual(group.stt, {});
});

test("a group clears itself after a long quiet time", () => {
  const group = make();
  assert.equal(groupExpired(group, T0 + GROUP_LIFETIME_MS - 1), false);
  assert.equal(groupExpired(group, T0 + GROUP_LIFETIME_MS), true);
  joinGroup(group, { roomId: "r1", lessonId: "animal-homes" }, T0 + 5000);
  assert.equal(groupExpired(group, T0 + GROUP_LIFETIME_MS), false, "activity moves the time on");
});

test("fifty rooms asking at once: starts stay at the rate, and the ones that wait too long are let go", () => {
  const group = make({ rate: 10 });
  for (let i = 0; i < 50; i += 1) joinGroup(group, { roomId: `r${i}`, lessonId: "animal-homes" }, T0);
  let started = 0;
  for (let i = 0; i < 50; i += 1) {
    if (submitAsk(group, { roomId: `r${i}`, askId: `q${i}`, name: `S${i}` }, T0 + i).start) started += 1;
  }
  assert.equal(started, 10);
  assert.equal(group.waiting.length, 40);
  // A minute later the next ten start, in the order they asked.
  const minute1 = drainWaiting(group, T0 + RATE_WINDOW_MS + 100);
  assert.deepEqual(minute1.start.map((item) => item.askId), Array.from({ length: 10 }, (_, i) => `q${i + 10}`));
  // A second minute on, the rest have waited the whole limit: they are let go to ask again.
  const minute2 = drainWaiting(group, T0 + QUEUE_TTL_MS + 100);
  assert.equal(minute2.start.length, 0);
  assert.deepEqual(minute2.expired.map((item) => item.askId), Array.from({ length: 30 }, (_, i) => `q${i + 20}`));
  assert.equal(group.waiting.length, 0);
});

test("rooms with no question of their own each get an answer, spread evenly", () => {
  const group = make();
  for (let i = 0; i < 6; i += 1) publishAnswer(group, answer(`q${i}`, `ask${i}`), T0);
  const counts = {};
  for (let i = 0; i < 50; i += 1) {
    const got = pickAnswer(group, `quiet${i}`, T0 + 10, (n) => (i + 3) % n);
    assert.ok(got);
    counts[got.askId] = (counts[got.askId] || 0) + 1;
  }
  const values = Object.values(counts);
  assert.ok(Math.max(...values) - Math.min(...values) <= 1, JSON.stringify(counts));
});
