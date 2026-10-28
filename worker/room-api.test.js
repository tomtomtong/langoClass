import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { handleRoomApi } from "./room-api.js";
import { claimRoomId } from "./room-index.js";
import { api, developerToken, memoryD1 } from "./test-env.js";

// Stands in for the RoomDurableObject namespace with the methods room-api.js calls.
function memoryRooms() {
  const rooms = new Map();
  return {
    rooms,
    getByName(roomId) {
      return {
        async open(input) {
          rooms.set(roomId, {
            teacherId: input.teacherId,
            className: input.classItem?.name || "",
            status: "waiting",
            studentList: input.classItem?.studentList || [],
          });
          return { roomId };
        },
        async read() {
          const room = rooms.get(roomId);
          return room ? { roomId, teacherId: room.teacherId, className: room.className, status: room.status } : null;
        },
        async syncRoster(classItem) {
          const room = rooms.get(roomId);
          if (!room) return { ok: false };
          room.studentList = classItem.studentList;
          return { ok: true, studentCount: room.studentList.length };
        },
        async close() {
          const room = rooms.get(roomId);
          if (room) room.status = "ended";
          return { ok: true, scoresPending: 0 };
        },
      };
    },
  };
}

async function setup() {
  const env = { DB: memoryD1(), ROOM: memoryRooms() };
  const token = await developerToken(handleStoreApi, env);
  return { env, call: api(handleRoomApi, env, token) };
}

const CLASS_5A = {
  id: 62,
  name: "5A",
  studentList: [
    { id: 1001, student_id: "S-1001", first_name: "Ada", last_name: "Lam" },
    { id: 1002, fullName: "Bo Chan", username: "BoC" },
  ],
};

test("a teacher opens a room without the Node origin and students find it by ID", async () => {
  const { env, call } = await setup();
  const started = await call("/api/session/start", { method: "POST", json: { class: CLASS_5A, user: { id: 835 }, uiLocale: "en" } });
  assert.equal(started.status, 201);
  const { roomId, sessionId } = await started.json();
  assert.match(roomId, /^\d{6}$/);
  assert.equal(sessionId, roomId);
  assert.equal(env.ROOM.rooms.get(roomId).studentList[0].fullName, "Ada Lam");

  for (const key of ["1001", "S-1001", "s-1001"]) {
    const found = await call(`/api/join/lookup?studentId=${key}`);
    assert.equal(found.status, 200, key);
    assert.deepEqual(await found.json(), {
      ok: true,
      roomId,
      userId: "1001",
      displayName: "Ada Lam",
      className: "5A",
      sessionStatus: "waiting",
    });
  }
  const byUsername = await (await call("/api/join/lookup?student_id=boc")).json();
  assert.equal(byUsername.displayName, "Bo Chan");

  const missing = await call("/api/join/lookup?studentId=9999");
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).message, /no class open for you/);
});

test("ending a room closes it and removes it from student lookup", async () => {
  const { env, call } = await setup();
  const { roomId } = await (await call("/api/session/start", { method: "POST", json: { class: CLASS_5A, user: { id: 835 } } })).json();
  const ended = await call("/api/session/end", { method: "POST", json: { roomId, class: CLASS_5A, user: { id: 835 } } });
  assert.equal(ended.status, 200);
  assert.deepEqual(await ended.json(), { ok: true, roomId });
  assert.equal(env.ROOM.rooms.get(roomId).status, "ended");
  assert.equal((await call("/api/join/lookup?studentId=1001")).status, 404);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM room_students").get().n, 0);
});

test("a roster update adds students to lookup; other teachers cannot change the room", async () => {
  const { env, call } = await setup();
  const { roomId } = await (await call("/api/session/start", { method: "POST", json: { class: CLASS_5A, user: { id: 835 } } })).json();
  const roster = await call("/api/session/roster", {
    method: "PUT",
    json: { roomId, class: { ...CLASS_5A, studentList: [...CLASS_5A.studentList, { id: 1003, name: "Cy Ho" }] } },
  });
  assert.deepEqual(await roster.json(), { ok: true, studentCount: 3 });
  assert.equal((await (await call("/api/join/lookup?studentId=1003")).json()).displayName, "Cy Ho");

  env.ROOM.rooms.get(roomId).teacherId = 999;
  const blocked = await call("/api/session/end", { method: "POST", json: { roomId } });
  assert.equal(blocked.status, 403);
  assert.equal((await call("/api/session/end", { method: "POST", json: { roomId: "000000" } })).status, 404);
});

test("lookup prefers the newest open room and drops rooms that ended elsewhere", async () => {
  const { env, call } = await setup();
  const first = (await (await call("/api/session/start", { method: "POST", json: { class: CLASS_5A, user: { id: 835 } } })).json()).roomId;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = (await (await call("/api/session/start", { method: "POST", json: { class: CLASS_5A, user: { id: 835 } } })).json()).roomId;
  assert.notEqual(first, second);
  assert.equal((await (await call("/api/join/lookup?studentId=1001")).json()).roomId, second);

  // The host never came back, so the room ended itself without /api/session/end.
  env.ROOM.rooms.get(second).status = "ended";
  assert.equal((await (await call("/api/join/lookup?studentId=1001")).json()).roomId, first);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM open_rooms WHERE room_id = ?").get(second).n, 0);
});

test("session start needs a signed-in teacher and a class", async () => {
  const { env, call } = await setup();
  const anonymous = await handleRoomApi(
    new Request("https://class.lango.ai/api/session/start", { method: "POST", body: "{}" }),
    env,
    new URL("https://class.lango.ai/api/session/start")
  );
  assert.equal(anonymous.status, 401);
  const noClass = await call("/api/session/start", { method: "POST", json: { user: { id: 835 } } });
  assert.equal(noClass.status, 400);
});

test("a room code still in use is never handed out twice; an ended one is reused", async () => {
  const env = { DB: memoryD1(), ROOM: memoryRooms() };
  const sequence = [0.5, 0.5, 0.25];
  const random = () => sequence.shift();
  const first = await claimRoomId(env, { teacherId: 835, classId: 62, className: "5A", random });
  await env.ROOM.getByName(first).open({ teacherId: 835, classItem: { name: "5A" } });
  const second = await claimRoomId(env, { teacherId: 835, classId: 62, className: "5A", random });
  assert.equal(first, "550000");
  assert.equal(second, "325000");

  env.ROOM.rooms.get(first).status = "ended";
  const reused = await claimRoomId(env, { teacherId: 835, classId: 63, className: "5B", random: () => 0.5 });
  assert.equal(reused, "550000");
  assert.equal(env.DB.raw.prepare("SELECT class_id FROM open_rooms WHERE room_id = ?").get("550000").class_id, "63");
});
