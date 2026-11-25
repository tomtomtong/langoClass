// Uncle Tommy thanking the students who got it right, by name (room-cheer.js).
import assert from "node:assert/strict";
import test from "node:test";
import { cheerLine, requestCheer, applyCheerJob, MAX_CHEER_NAMES } from "./room-cheer.js";

const host = { role: "host", socketId: "host-1", caps: { speech: true } };
const state = () => ({ session: { variant: "" } });

test("the line names everyone, in the lesson's language", () => {
  assert.equal(cheerLine(["Ada"], "yue"), "Ada，答得好呀，好叻！");
  assert.equal(cheerLine(["Ada", "Bo", "Cy"], "yue"), "多謝 Ada、Bo 同 Cy，答得又快又啱！");
  assert.equal(cheerLine(["Ada", "Bo"], "en"), "Well done Ada and Bo! Great answers!");
});

test("the host gets a voiced line back for at most three names", () => {
  const sent = requestCheer(state(), { names: ["A", "B", "C", "D"], lesson: { language: "yue" } }, host);
  assert.equal(sent.ack.pending, true);
  assert.equal(sent.jobs[0].kind, "result-cheer");
  assert.equal(sent.jobs[0].names.length, MAX_CHEER_NAMES);
  const done = applyCheerJob(state(), sent.jobs[0], {});
  assert.equal(done.broadcasts[0].hostOnly, true);
  assert.equal(done.broadcasts[0].data.audioContent, null);
});

test("no names, no voice or a non-host asks for nothing", () => {
  assert.equal(requestCheer(state(), { names: [] }, host).ack.pending, false);
  assert.equal(requestCheer(state(), { names: ["A"] }, { ...host, caps: {} }).ack.pending, false);
  assert.equal(requestCheer(state(), { names: ["A"] }, { role: "session_player", playerId: "x" }).ack.ok, false);
});
