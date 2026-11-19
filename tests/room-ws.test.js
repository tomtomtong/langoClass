const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "room-ws.js"), "utf8");

// Loads public/room-ws.js with a fake WebSocket that records every socket
// opened and every frame sent.
function loadRoomWs() {
  const sockets = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      sockets.push(this);
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
    receive(message) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }
  const context = {
    console,
    URL,
    WebSocket: FakeWebSocket,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    location: { href: "https://class.lango.ai/host.html" },
    addEventListener: () => {},
    document: { addEventListener: () => {}, visibilityState: "visible" },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { io: context.io, sockets };
}

const roomOf = (ws) => new URL(ws.url).pathname.split("/")[3];
const frames = (ws) => ws.sent.filter((data) => data !== "ping").map((data) => JSON.parse(data));

test("an emit for another room moves the socket to that room", () => {
  const { io, sockets } = loadRoomWs();
  const socket = io();
  socket.emit("create_room_game", { roomId: "876383" }, () => {});
  sockets[0].open();
  assert.equal(roomOf(sockets[0]), "876383");

  // The teacher ends that class and starts a quiz in the next one.
  let ack = null;
  socket.emit("create_room_game", { roomId: "984021" }, (res) => {
    ack = res;
  });
  assert.equal(sockets.length, 2, "opens a socket for the new room");
  assert.equal(roomOf(sockets[1]), "984021");
  assert.equal(sockets[0].readyState, 3, "closes the old room's socket");
  assert.equal(frames(sockets[0]).length, 1, "nothing more goes to the old room");

  sockets[1].open();
  const [frame] = frames(sockets[1]);
  assert.equal(frame.event, "create_room_game");
  assert.equal(frame.data.roomId, "984021");
  sockets[1].receive({ t: "ack", id: frame.id, data: { ok: true } });
  assert.deepEqual({ ...ack }, { ok: true });
});

test("emits without a room id go to the room the socket moved to", () => {
  const { io, sockets } = loadRoomWs();
  const socket = io();
  socket.emit("create_room_game", { roomId: "111111" });
  sockets[0].open();
  socket.emit("create_room_game", { roomId: "222222" });
  sockets[1].open();
  socket.emit("next_question");
  assert.deepEqual(frames(sockets[1]).map((f) => f.event), ["create_room_game", "next_question"]);
});

test("moving to another room is not a reconnect", () => {
  const { io, sockets } = loadRoomWs();
  const socket = io();
  let reconnects = 0;
  socket.on("reconnect", () => {
    reconnects += 1;
  });
  socket.connect("111111");
  sockets[0].open();
  socket.emit("host_session", { roomId: "222222" });
  sockets[1].open();
  assert.equal(reconnects, 0);

  // Losing the new room's socket and getting it back still is one.
  sockets[1].onclose();
  socket.connect();
  assert.equal(roomOf(sockets[2]), "222222");
  sockets[2].open();
  assert.equal(reconnects, 1);
});

test("frames queued for the old room are not sent to the new one", () => {
  const { io, sockets } = loadRoomWs();
  const socket = io();
  let oldAck = null;
  socket.emit("answer", { roomId: "111111" }, (res) => {
    oldAck = res;
  });
  // The old room never opened; the host moves on.
  socket.emit("host_session", { roomId: "222222" });
  sockets[1].open();
  assert.deepEqual(frames(sockets[1]).map((f) => f.event), ["host_session"]);
  assert.equal(oldAck?.ok, false);
});

test("an emit for the same room keeps the socket", () => {
  const { io, sockets } = loadRoomWs();
  const socket = io();
  socket.emit("join_session", { roomId: "333333" });
  sockets[0].open();
  socket.emit("submit_answer", { roomId: "333333" });
  assert.equal(sockets.length, 1);
  assert.equal(frames(sockets[0]).length, 2);
});
