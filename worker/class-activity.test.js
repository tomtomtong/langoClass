import assert from "node:assert/strict";
import test from "node:test";
import { activityEntries, groupBySchool, liveRoom, presenceOf } from "./class-activity.js";
import { applyRoomEvent, markSocketClosed } from "./room-events.js";
import { createRoomState } from "./room-state.js";

const CLASS_5A = {
  id: 62,
  name: "5A",
  studentList: [
    { id: 1001, studentCode: "STU-0604", fullName: "Ada Lam" },
    { id: 1002, studentCode: "STU-0605", fullName: "Bo Chan" },
  ],
};

function room() {
  return createRoomState({ roomId: "123456", teacherId: 835, schoolId: "abgps", classItem: CLASS_5A, now: 1000 });
}

function ctx(socketId, extra = {}) {
  return { socketId, now: 2000, pick: () => 0, caps: {}, ...extra };
}

// Runs one change and returns the log entries it produces.
function step(state, change) {
  const before = presenceOf(state);
  const copy = structuredClone(state);
  const next = change(copy) || copy;
  return { state: next, entries: activityEntries(before, presenceOf(next), next) };
}

test("opening a room logs the school, class and roster size", () => {
  const state = room();
  const entries = activityEntries(null, presenceOf(state), state);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    sessionId: "class-room-123456-1000",
    schoolId: "abgps",
    teacherId: "835",
    code: "class_opened",
    level: "info",
    context: { room_id: "123456", class_id: "62", class_name: "5A", online_count: 0, roster_count: 2 },
  });
});

test("students joining, dropping and coming back are logged by student code, not name", () => {
  let state = room();
  let result = step(state, (s) => applyRoomEvent(s, { event: "join_session", data: { userId: "1001" } }, ctx("sock-a")).state);
  assert.deepEqual(result.entries.map((e) => e.code), ["student_joined"]);
  assert.equal(result.entries[0].context.student_code, "STU-0604");
  assert.equal(result.entries[0].context.online_count, 1);
  assert.doesNotMatch(JSON.stringify(result.entries), /Ada|Lam/);

  result = step(result.state, (s) => markSocketClosed(s, { socketId: "sock-a", now: 3000 }).state);
  assert.deepEqual(result.entries.map((e) => [e.code, e.level]), [["student_offline", "warn"]]);
  assert.equal(result.entries[0].context.online_count, 0);

  result = step(result.state, (s) => applyRoomEvent(s, { event: "join_session", data: { userId: "1001" } }, ctx("sock-b")).state);
  assert.deepEqual(result.entries.map((e) => e.code), ["student_reconnected"]);
});

test("teacher presence and the class ending are logged", () => {
  let result = step(room(), (s) => applyRoomEvent(s, { event: "host_session", data: {} }, ctx("host-1")).state);
  assert.deepEqual(result.entries.map((e) => e.code), ["teacher_online"]);

  result = step(result.state, (s) => markSocketClosed(s, { socketId: "host-1", now: 3000 }).state);
  assert.deepEqual(result.entries.map((e) => e.code), ["teacher_offline"]);

  const ended = step(result.state, (s) => {
    s.session.status = "ended";
    s.closed = true;
    return s;
  });
  assert.deepEqual(ended.entries.map((e) => [e.code, e.context.end_reason]), [["class_ended", "teacher"]]);
  const timedOut = step(result.state, (s) => {
    s.session.status = "ended";
    return s;
  });
  assert.deepEqual(timedOut.entries.map((e) => [e.code, e.level, e.context.end_reason]), [["class_ended", "warn", "teacher_offline"]]);
});

test("a save that changes nothing logs nothing", () => {
  const state = room();
  assert.deepEqual(activityEntries(presenceOf(state), presenceOf(state), state), []);
  assert.deepEqual(activityEntries(presenceOf(state), null, null), []);
});

test("the live view lists open rooms by school with who is offline", () => {
  let state = room();
  state = applyRoomEvent(state, { event: "join_session", data: { userId: "1001" } }, ctx("sock-a")).state;
  state = applyRoomEvent(state, { event: "join_session", data: { userId: "1002" } }, ctx("sock-b")).state;
  state = markSocketClosed(state, { socketId: "sock-b", now: 5000 }).state;
  const live = liveRoom(state);
  assert.equal(live.school_id, "abgps");
  assert.equal(live.online_count, 1);
  assert.equal(live.teacher_online, false);
  assert.equal(live.log_session_id, "class-room-123456-1000");
  assert.deepEqual(live.offline, [{ student: "STU-0605", name: "Bo Chan", since: 5000 }]);

  const other = { ...live, school_id: "0002", room_id: "654321", online_count: 3 };
  const unknown = { ...live, school_id: "", room_id: "111111", online_count: 0 };
  const grouped = groupBySchool([unknown, other, live]);
  assert.deepEqual(grouped.map((g) => [g.school_id, g.online_count]), [["0002", 3], ["abgps", 1], ["", 0]]);

  state.session.status = "ended";
  assert.equal(liveRoom(state), null);
});
