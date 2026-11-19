import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent } from "./room-events.js";

function room() {
  return createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "5A" }, now: 1000 });
}

const host = { socketId: "host-1", role: "host", now: 2000, pick: () => 0 };
const student = { socketId: "s-1", role: "session_player", playerId: "ada", now: 3000, pick: () => 0 };

function withStudent() {
  const state = room();
  state.session.participants = [{ userId: "ada", displayName: "Ada", online: true, joinedAt: 1 }];
  return state;
}

test("reactions are off until the host turns them on", () => {
  const state = withStudent();
  const sent = applyRoomEvent(state, { event: "send_reaction", data: { emoji: "👍" } }, student);
  assert.equal(sent.ack.ok, false);
  assert.equal(sent.broadcasts.length, 0);
  assert.equal(sent.state, null, "a refused reaction writes nothing");

  const joined = applyRoomEvent(state, { event: "join_session", data: { displayName: "Bo", userId: "bo" } }, {
    socketId: "s-2", role: null, now: 3000, pick: () => 0,
  });
  assert.equal(joined.ack.reactions, false);
});

test("only the host can turn reactions on, and everyone is told", () => {
  const state = withStudent();
  const refused = applyRoomEvent(state, { event: "set_reactions", data: { enabled: true } }, student);
  assert.equal(refused.ack.ok, false);
  assert.equal(state.session.reactions, undefined);

  const on = applyRoomEvent(state, { event: "set_reactions", data: { enabled: true } }, host);
  assert.equal(on.ack.ok, true);
  assert.equal(on.state.session.reactions, true);
  assert.equal(on.broadcasts[0].event, "reactions_state");
  assert.equal(on.broadcasts[0].data.enabled, true);
  assert.ok(on.broadcasts[0].data.emojis.includes("👍"));
  assert.notEqual(on.broadcasts[0].hostOnly, true);

  const joined = applyRoomEvent(on.state, { event: "join_session", data: { displayName: "Bo", userId: "bo" } }, {
    socketId: "s-2", role: null, now: 3000, pick: () => 0,
  });
  assert.equal(joined.ack.reactions, true);
  assert.ok(joined.ack.reactionEmojis.length > 0);
});

test("a student's reaction goes to the host only, with their name, and writes no state", () => {
  const state = withStudent();
  state.session.reactions = true;
  state.session.emojiOpen = true;
  const sent = applyRoomEvent(state, { event: "send_reaction", data: { emoji: "🎉" } }, student);
  assert.equal(sent.ack.ok, true);
  assert.equal(sent.state, null);
  assert.deepEqual(sent.broadcasts, [{ event: "reaction", hostOnly: true, data: { emoji: "🎉", name: "Ada" } }]);
});

test("unknown emojis and non-students are refused", () => {
  const state = withStudent();
  state.session.reactions = true;
  state.session.emojiOpen = true;
  const odd = applyRoomEvent(state, { event: "send_reaction", data: { emoji: "<img>" } }, student);
  assert.equal(odd.ack.ok, false);
  assert.equal(odd.broadcasts.length, 0);

  const stranger = applyRoomEvent(state, { event: "send_reaction", data: { emoji: "👍" } }, {
    socketId: "x", role: null, now: 3000, pick: () => 0,
  });
  assert.equal(stranger.ack.ok, false);
});

test("\"I don't get it\" goes to the host only, with the student's id and no name", () => {
  const state = withStudent();
  state.session.reactions = true;
  const sent = applyRoomEvent(state, { event: "send_lost", data: {} }, student);
  assert.equal(sent.ack.ok, true);
  assert.equal(sent.state, null);
  assert.deepEqual(sent.broadcasts, [{ event: "lost", hostOnly: true, data: { playerId: "ada" } }]);
});

test("\"I don't get it\" is refused while reactions are off, and from non-students", () => {
  const state = withStudent();
  const off = applyRoomEvent(state, { event: "send_lost", data: {} }, student);
  assert.equal(off.ack.ok, false);
  assert.equal(off.broadcasts.length, 0);

  state.session.reactions = true;
  const stranger = applyRoomEvent(state, { event: "send_lost", data: {} }, {
    socketId: "x", role: null, now: 3000, pick: () => 0,
  });
  assert.equal(stranger.ack.ok, false);
  assert.equal(stranger.broadcasts.length, 0);
});

test("the emoji bar is closed until the host opens it, even with reactions on", () => {
  const state = withStudent();
  const on = applyRoomEvent(state, { event: "set_reactions", data: { enabled: true } }, host);
  assert.equal(on.broadcasts[0].data.emojiOpen, false);

  const closed = applyRoomEvent(on.state, { event: "send_reaction", data: { emoji: "👍" } }, student);
  assert.equal(closed.ack.ok, false);
  assert.equal(closed.broadcasts.length, 0);
  assert.equal(closed.state, null);

  const open = applyRoomEvent(on.state, { event: "set_emoji", data: { open: true } }, host);
  assert.equal(open.ack.ok, true);
  assert.equal(open.state.session.emojiOpen, true);
  assert.equal(open.broadcasts[0].event, "reactions_state");
  assert.equal(open.broadcasts[0].data.emojiOpen, true);
  assert.notEqual(open.broadcasts[0].hostOnly, true, "the phones are told");
  const sent = applyRoomEvent(open.state, { event: "send_reaction", data: { emoji: "👍" } }, student);
  assert.equal(sent.ack.ok, true);

  const shut = applyRoomEvent(open.state, { event: "set_emoji", data: { open: false } }, host);
  assert.equal(shut.broadcasts[0].data.emojiOpen, false);
  assert.equal(applyRoomEvent(shut.state, { event: "send_reaction", data: { emoji: "👍" } }, student).ack.ok, false);
});

test("only the host opens the emoji bar, and it never opens while reactions are off", () => {
  const state = withStudent();
  const refused = applyRoomEvent(state, { event: "set_emoji", data: { open: true } }, student);
  assert.equal(refused.ack.ok, false);
  assert.equal(state.session.emojiOpen, undefined);

  const off = applyRoomEvent(state, { event: "set_emoji", data: { open: true } }, host);
  assert.equal(off.broadcasts[0].data.emojiOpen, false, "reactions are off, so the phones see it closed");
  assert.equal(applyRoomEvent(off.state, { event: "send_reaction", data: { emoji: "👍" } }, student).ack.ok, false);
});

test("a student who joins or rejoins is told whether the emoji bar is open", () => {
  const state = withStudent();
  state.session.reactions = true;
  const join = () => applyRoomEvent(state, { event: "join_session", data: { displayName: "Bo", userId: "bo" } }, {
    socketId: "s-2", role: null, now: 3000, pick: () => 0,
  });
  assert.equal(join().ack.reactionEmojiOpen, false);
  state.session.emojiOpen = true;
  assert.equal(join().ack.reactionEmojiOpen, true);
});

test("\"I don't get it\" works while the emoji bar is closed", () => {
  const state = withStudent();
  state.session.reactions = true;
  const sent = applyRoomEvent(state, { event: "send_lost", data: {} }, student);
  assert.equal(sent.ack.ok, true);
});
