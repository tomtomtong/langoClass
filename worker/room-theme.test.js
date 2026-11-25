import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent } from "./room-events.js";
import { validateLessonScript } from "../lib/autoclass-script.mjs";
import { readFileSync } from "node:fs";

const hostCtx = { socketId: "host-1", role: "host", now: 2000, pick: () => 0 };
const fresh = () => createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "x" }, now: 1000 });
const hostWith = (state, data) => applyRoomEvent(state, { event: "host_session", data: { roomId: "123456", ...data } }, hostCtx).state;
const join = (state) => applyRoomEvent(state, { event: "join_session", data: { roomId: "123456", displayName: "陳伯" } }, { socketId: "s-1", now: 3000, pick: () => 0 });

test("the room tells phones its join-page look", () => {
  assert.equal(join(hostWith(fresh(), { uiLocale: "en" })).ack.theme, "");
  assert.equal(join(hostWith(fresh(), { theme: "elderly" })).ack.theme, "elderly");
  // The default look on a light-blue background.
  assert.equal(join(hostWith(fresh(), { theme: "mist" })).ack.theme, "mist");
  // The hk host page asks with its variant.
  const hk = join(hostWith(fresh(), { variant: "hk-elderly" }));
  assert.equal(hk.ack.theme, "elderly");
  assert.equal(hk.broadcasts.find((b) => b.event === "session_lobby_update").data.theme, "elderly");
  // Unknown themes fall back to the default; a reconnect that says nothing keeps the theme.
  assert.equal(join(hostWith(fresh(), { theme: "neon" })).ack.theme, "");
  assert.equal(join(hostWith(hostWith(fresh(), { theme: "elderly" }), {})).ack.theme, "elderly");
  // A host that turns elderly mode off says theme "" and the room goes back to the default.
  assert.equal(join(hostWith(hostWith(fresh(), { theme: "elderly" }), { theme: "" })).ack.theme, "");
});

test("a lesson script may ask for the elderly look", () => {
  const lesson = JSON.parse(readFileSync(new URL("../autoclass-video/lessons/hk-nostalgia.json", import.meta.url), "utf8"));
  assert.equal(validateLessonScript(lesson).script.theme, "elderly");
  const { theme, ...plain } = lesson;
  assert.equal("theme" in validateLessonScript(plain).script, false);
  const bad = validateLessonScript({ ...lesson, theme: "neon" });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.path), ["theme"]);
});
