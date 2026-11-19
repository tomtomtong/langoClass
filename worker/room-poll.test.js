import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent } from "./room-events.js";

const host = { socketId: "host-1", role: "host", now: 2000, pick: () => 0 };
const ada = { socketId: "s-1", role: "session_player", playerId: "ada", now: 3000, pick: () => 0 };
const bo = { socketId: "s-2", role: "session_player", playerId: "bo", now: 3000, pick: () => 0 };
const POLL = { id: "p1", question: "Which animal do you like best?", options: ["bird", "bee", "fish"] };

function room() {
  const state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "5A" }, now: 1000 });
  state.session.participants = [
    { userId: "ada", displayName: "Ada", online: true, joinedAt: 1 },
    { userId: "bo", displayName: "Bo", online: true, joinedAt: 1 },
  ];
  return state;
}

function withPoll() {
  return applyRoomEvent(room(), { event: "start_poll", data: POLL }, host).state;
}

test("the host starts a poll: everyone gets the question, the host gets empty counts", () => {
  const started = applyRoomEvent(room(), { event: "start_poll", data: POLL }, host);
  assert.deepEqual(started.ack, { ok: true, id: "p1" });
  assert.deepEqual(started.broadcasts, [
    { event: "poll_state", data: { id: "p1", question: POLL.question, options: POLL.options, open: true } },
    { event: "poll_votes", hostOnly: true, data: { id: "p1", counts: [0, 0, 0], voters: 0 } },
  ]);
});

test("only the host can start or end a poll, and it needs a question and two options", () => {
  assert.equal(applyRoomEvent(room(), { event: "start_poll", data: POLL }, ada).ack.ok, false);
  assert.equal(applyRoomEvent(room(), { event: "start_poll", data: { question: "Why?", options: ["yes"] } }, host).ack.ok, false);
  assert.equal(applyRoomEvent(room(), { event: "start_poll", data: { question: "", options: ["yes", "no"] } }, host).ack.ok, false);

  const state = withPoll();
  assert.equal(applyRoomEvent(state, { event: "end_poll", data: {} }, ada).ack.ok, false);
  assert.ok(state.session.poll, "the poll is still open");
});

test("a poll keeps at most four options", () => {
  const started = applyRoomEvent(room(), { event: "start_poll", data: { question: "Pick", options: ["a", "b", "c", "d", "e"] } }, host);
  assert.deepEqual(started.state.session.poll.options, ["a", "b", "c", "d"]);
});

test("each student votes once; the host gets counts and no names", () => {
  let state = withPoll();
  const first = applyRoomEvent(state, { event: "send_poll_vote", data: { id: "p1", index: 1 } }, ada);
  assert.deepEqual(first.ack, { ok: true, index: 1 });
  assert.deepEqual(first.broadcasts, [
    { event: "poll_votes", hostOnly: true, data: { id: "p1", counts: [0, 1, 0], voters: 1 } },
  ]);
  state = first.state;

  const again = applyRoomEvent(state, { event: "send_poll_vote", data: { id: "p1", index: 2 } }, ada);
  assert.deepEqual(again.ack, { ok: true, index: 1 }, "the first vote stays");
  assert.equal(again.state, null);
  assert.equal(again.broadcasts.length, 0);

  const second = applyRoomEvent(state, { event: "send_poll_vote", data: { id: "p1", index: 1 } }, bo);
  assert.deepEqual(second.broadcasts[0].data, { id: "p1", counts: [0, 2, 0], voters: 2 });
});

test("votes are refused without a poll, for another poll, out of range, and from non-students", () => {
  const none = applyRoomEvent(room(), { event: "send_poll_vote", data: { index: 0 } }, ada);
  assert.equal(none.ack.ok, false);

  const state = withPoll();
  for (const data of [{ id: "old", index: 0 }, { id: "p1", index: 3 }, { id: "p1", index: -1 }, { id: "p1", index: "x" }, { id: "p1" }]) {
    const vote = applyRoomEvent(state, { event: "send_poll_vote", data }, ada);
    assert.equal(vote.ack.ok, false, JSON.stringify(data));
    assert.equal(vote.state, null);
  }
  const stranger = applyRoomEvent(state, { event: "send_poll_vote", data: { id: "p1", index: 0 } }, {
    socketId: "x", role: null, now: 3000, pick: () => 0,
  });
  assert.equal(stranger.ack.ok, false);
  assert.deepEqual(state.session.poll.votes, {});
});

test("ending a poll tells everyone it closed and gives the host the final counts", () => {
  const state = applyRoomEvent(withPoll(), { event: "send_poll_vote", data: { id: "p1", index: 2 } }, ada).state;
  const ended = applyRoomEvent(state, { event: "end_poll", data: {} }, host);
  assert.deepEqual(ended.ack, { ok: true, id: "p1", counts: [0, 0, 1], voters: 1 });
  assert.deepEqual(ended.broadcasts, [{ event: "poll_state", data: { id: "p1", open: false } }]);
  assert.equal(ended.state.session.poll, undefined);

  const late = applyRoomEvent(ended.state, { event: "send_poll_vote", data: { id: "p1", index: 0 } }, bo);
  assert.equal(late.ack.ok, false);
  assert.equal(applyRoomEvent(ended.state, { event: "end_poll", data: {} }, host).ack.ok, true, "ending twice is fine");
});

test("a student who joins during a poll gets it, with their own vote", () => {
  const state = applyRoomEvent(withPoll(), { event: "send_poll_vote", data: { id: "p1", index: 0 } }, ada).state;
  const back = applyRoomEvent(state, { event: "join_session", data: { displayName: "Ada", userId: "ada" } }, {
    socketId: "s-9", role: null, now: 4000, pick: () => 0,
  });
  assert.deepEqual(back.ack.poll, { id: "p1", question: POLL.question, options: POLL.options, open: true, myVote: 0 });

  const fresh = applyRoomEvent(state, { event: "join_session", data: { displayName: "Cy", userId: "cy" } }, {
    socketId: "s-8", role: null, now: 4000, pick: () => 0,
  });
  assert.equal(fresh.ack.poll.myVote, null);

  const noPoll = applyRoomEvent(room(), { event: "join_session", data: { displayName: "Cy", userId: "cy" } }, {
    socketId: "s-8", role: null, now: 4000, pick: () => 0,
  });
  assert.equal(noPoll.ack.poll, null);
});

test("starting the next exercise closes an open poll first", () => {
  const next = applyRoomEvent(withPoll(), { event: "start_next_exercise", data: { exercise: { id: "e1", type: "video", items: [] } } }, host);
  assert.equal(next.ack.ok, true);
  assert.deepEqual(next.broadcasts[0], { event: "poll_state", data: { id: "p1", open: false } });
  assert.equal(next.state.session.poll, undefined);
});

test("a poll gives no points and starts no game", () => {
  let state = withPoll();
  state = applyRoomEvent(state, { event: "send_poll_vote", data: { id: "p1", index: 1 } }, ada).state;
  const ended = applyRoomEvent(state, { event: "end_poll", data: {} }, host);
  assert.equal(ended.state.game, null);
  assert.equal((ended.state.pendingScores || []).length, 0);
});
