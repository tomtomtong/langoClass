import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState, syncRoomRoster } from "./room-state.js";

test("a new room keeps session, game, buzz, and sockets together", () => {
  const state = createRoomState({
    roomId: "123456",
    teacherId: 835,
    classItem: { id: 62, name: "5A", studentList: [{ id: 1, fullName: "Ada" }] },
    course: { id: 9, name: "Demo" },
    uiLocale: "en",
    now: 1000,
  });

  assert.equal(state.session.roomId, "123456");
  assert.equal(state.session.teacherId, 835);
  assert.equal(state.session.className, "5A");
  assert.equal(state.session.status, "waiting");
  assert.equal(state.session.studentList.length, 1);
  assert.equal(state.session.courseId, 9);
  assert.equal(state.game, null);
  assert.equal(state.buzz, null);
  assert.deepEqual(state.sockets, {});
});

test("roster updates replace the student list on that room", () => {
  const state = createRoomState({
    roomId: "123456",
    teacherId: 835,
    classItem: { id: 62, name: "5A" },
  });
  const next = syncRoomRoster(state, {
    name: "5A",
    studentList: [
      { id: 1, fullName: "Ada" },
      { id: 2, fullName: "Bea" },
    ],
  });
  assert.equal(next.session.studentList.length, 2);
  assert.equal(state.session.studentList.length, 0);
});
