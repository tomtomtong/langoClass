import assert from "node:assert/strict";
import test from "node:test";
import { clearRoomGroup, hostCheck, joinCheck, roomGroupCode, setRoomGroup } from "./room-group.js";

const host = { socketId: "h", role: "host", now: 1 };
const student = { socketId: "s", role: "session_player", playerId: "ada", now: 1 };
const room = () => ({ session: { roomId: "123456" } });

test("only the host can link a room, with a four digit code and a lesson", () => {
  assert.equal(joinCheck(room(), { code: "1234", lessonId: "animal-homes" }, student).ok, false);
  assert.equal(joinCheck(room(), { code: "12", lessonId: "animal-homes" }, host).ok, false);
  assert.equal(joinCheck(room(), { code: "1234", lessonId: "" }, host).ok, false);
  const ok = joinCheck(room(), { code: " 1234 ", lessonId: "animal-homes", lessonTitle: "Animal Homes", rate: 8 }, host);
  assert.deepEqual(ok, { ok: true, code: "1234", lessonId: "animal-homes", lessonTitle: "Animal Homes", rate: 8, previous: "" });
});

test("joining another code remembers the old one so the room can leave it", () => {
  const state = room();
  setRoomGroup(state, "1111");
  assert.equal(roomGroupCode(state), "1111");
  assert.equal(joinCheck(state, { code: "2222", lessonId: "x" }, host).previous, "1111");
  clearRoomGroup(state);
  assert.equal(roomGroupCode(state), "");
});

test("pulling an answer needs the host and a group", () => {
  const state = room();
  assert.equal(hostCheck(state, host).ok, false);
  setRoomGroup(state, "1234");
  assert.equal(hostCheck(state, student).ok, false);
  assert.deepEqual(hostCheck(state, host), { ok: true, code: "1234" });
});
