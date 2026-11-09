import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent } from "./room-events.js";

// The host attaches `sectionTransition` to the exercise when the class moves into a new
// section; the room must hand it to students unchanged so they can show the same card.
test("start_next_exercise passes sectionTransition through to students", () => {
  const state = createRoomState({
    roomId: "123456",
    teacherId: 835,
    classItem: { id: 62, name: "5A" },
    course: { id: 7, name: "Maths" },
    exercise: { id: 12, type: "mcquiz", title: "Last of section 1" },
    now: 1000,
  });
  const sectionTransition = { id: 2, title: "Polite phrases", index: 2 };
  const result = applyRoomEvent(
    state,
    { event: "start_next_exercise", data: { exercise: { id: 21, type: "mcquiz", sectionTransition } } },
    { socketId: "host-1", role: "host", now: 2000, pick: () => 0 }
  );

  assert.equal(result.ack?.ok ?? true, true);
  const started = (result.broadcasts || []).find((item) => item.event === "session_started");
  assert.ok(started, "session_started is broadcast");
  assert.deepEqual(started.data.exercise.sectionTransition, sectionTransition);
  assert.equal(started.data.exercise.id, 21);
});

test("start_next_exercise passes an exercise-kind transition through to students", () => {
  const state = createRoomState({
    roomId: "123456",
    teacherId: 835,
    classItem: { id: 62, name: "5A" },
    course: { id: 7, name: "Maths" },
    exercise: { id: 12, type: "mcquiz", title: "First" },
    now: 1000,
  });
  const sectionTransition = { id: 21, title: "Second", kind: "exercise", holdMs: 1600 };
  const result = applyRoomEvent(
    state,
    { event: "start_next_exercise", data: { exercise: { id: 21, type: "mcquiz", sectionTransition } } },
    { socketId: "host-1", role: "host", now: 2000, pick: () => 0 }
  );
  const started = (result.broadcasts || []).find((item) => item.event === "session_started");
  assert.deepEqual(started.data.exercise.sectionTransition, sectionTransition);
});
