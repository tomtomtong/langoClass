// The linked rooms end to end: real RoomDurableObject and GroupDurableObject classes, run in Node
// with a pretend storage, pretend sockets, a pretend R2 and pretend models. Nothing is mocked
// between a room and its group, so this covers the calls they make to each other.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { before, test, mock } from "node:test";

const AI_STUB = `
export const completeText = (...a) => globalThis.__ai.completeText(...a);
export const speak = (...a) => globalThis.__ai.speak(...a);
export const speakAsTommy = (...a) => globalThis.__ai.speakAsTommy(...a);
export const transcribe = (...a) => globalThis.__ai.transcribe(...a);
export const transcribeTimed = (...a) => globalThis.__ai.transcribe(...a);
export const speechReady = () => true;
export const textModelReady = () => true;
export const speechProvider = () => "stub";
export const speechLanguageFor = (text, language) => language;
export const speakLangCode = (value) => value;
export const sttLanguage = (value, fallback) => value || fallback;
`;
const SETTINGS_STUB = "export const withSettings = async (env) => env; export const handleConfigApi = async () => null;";
const WORKERS_STUB = "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }";
const asModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

// Node's own loader is told to hand these three modules a pretend version.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: asModule(WORKERS_STUB), shortCircuit: true };
    const found = nextResolve(specifier, context);
    if (found.url.endsWith("/worker/ai.js")) return { url: asModule(AI_STUB), shortCircuit: true };
    if (found.url.endsWith("/worker/app-settings.js")) return { url: asModule(SETTINGS_STUB), shortCircuit: true };
    return found;
  },
});

let RoomDurableObject;
let GroupDurableObject;
before(async () => {
  globalThis.WebSocketRequestResponsePair = class {};
  ({ RoomDurableObject } = await import("./room.js"));
  ({ GroupDurableObject } = await import("./group.js"));
});

// ---- pretend platform ----

function fakeSql() {
  const tables = { room: null, audio: new Map(), grp: null };
  const rows = (list) => ({ toArray: () => list });
  return {
    exec(sql, ...params) {
      const q = sql.replace(/\s+/g, " ").trim();
      if (/^CREATE TABLE/.test(q)) return rows([]);
      if (q.startsWith("SELECT body FROM room")) return rows(tables.room ? [{ body: tables.room }] : []);
      if (q.startsWith("INSERT INTO room")) { tables.room = params[0]; return rows([]); }
      if (q.startsWith("DELETE FROM room")) { tables.room = null; return rows([]); }
      if (q.startsWith("INSERT INTO audio")) { tables.audio.set(params[0], params[1]); return rows([]); }
      if (q.startsWith("SELECT body FROM audio")) return rows(tables.audio.has(params[0]) ? [{ body: tables.audio.get(params[0]) }] : []);
      if (q.startsWith("DELETE FROM audio")) { tables.audio.clear(); return rows([]); }
      if (q.startsWith("SELECT body FROM grp")) return rows(tables.grp ? [{ body: tables.grp }] : []);
      if (q.startsWith("INSERT INTO grp")) { tables.grp = params[0]; return rows([]); }
      if (q.startsWith("DELETE FROM grp")) { tables.grp = null; return rows([]); }
      throw new Error(`fake sql does not know: ${q}`);
    },
  };
}

function fakeCtx(sockets = []) {
  const alarm = { at: null };
  return {
    alarm,
    storage: { sql: fakeSql(), setAlarm: async (at) => { alarm.at = at; }, deleteAlarm: async () => { alarm.at = null; } },
    blockConcurrencyWhile: (fn) => fn(),
    setWebSocketAutoResponse() {},
    getWebSockets: () => sockets,
    acceptWebSocket() {},
    waitUntil() {},
  };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, options) { objects.set(key, { bytes, options }); },
    async list({ prefix }) { return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
    async delete(keys) { for (const key of [].concat(keys)) objects.delete(key); },
  };
}

function fakeSocket(role, playerId) {
  const socket = {
    attachment: { id: `sock-${Math.random().toString(36).slice(2)}`, role: null, playerId: null },
    sent: [],
    serializeAttachment(value) { this.attachment = value; },
    deserializeAttachment() { return this.attachment; },
    send(text) { this.sent.push(JSON.parse(text)); },
    events(name) { return this.sent.filter((m) => m.t === "event" && m.event === name).map((m) => m.data); },
    acks() { return this.sent.filter((m) => m.t === "ack").map((m) => m.data); },
    lastAck() { return this.acks().at(-1); },
  };
  socket.role = role;
  socket.playerId = playerId;
  return socket;
}

const LESSON = { title: "Animal Homes", outline: "A bird lives in a nest.", language: "en", sttLanguage: "en" };

function world() {
  const r2 = fakeR2();
  const rooms = new Map();
  const groups = new Map();
  const env = {
    UPLOADS: r2,
    ROOM: { getByName: (id) => rooms.get(id).dobj },
    GROUP: {
      getByName(code) {
        if (!groups.has(code)) groups.set(code, new GroupDurableObject(fakeCtx(), env));
        return groups.get(code);
      },
    },
  };
  let ids = 0;
  async function room(roomId, students = []) {
    const sockets = [];
    const dobj = new RoomDurableObject(fakeCtx(sockets), env);
    rooms.set(roomId, { dobj, sockets });
    dobj.open({ roomId, teacherId: 1, classItem: { id: 1, name: roomId, studentList: [] } });
    let seq = 0;
    const send = async (ws, event, data = {}) => {
      seq += 1;
      await dobj.webSocketMessage(ws, JSON.stringify({ t: "emit", id: `m${++ids}-${seq}`, event, data }));
      return ws.lastAck();
    };
    const host = fakeSocket("host");
    sockets.push(host);
    await send(host, "host_session", { roomId });
    const out = { roomId, dobj, host, send, students: {} };
    for (const name of students) {
      const ws = fakeSocket("student", name);
      sockets.push(ws);
      await send(ws, "join_session", { displayName: name, userId: name });
      out.students[name] = ws;
    }
    await send(host, "set_tutor", { enabled: true, lesson: LESSON });
    return out;
  }
  return { env, r2, room, groups, rooms };
}

function models() {
  globalThis.__ai = {
    completeText: async () => JSON.stringify({ ok: true, question: "Why do birds build nests?", answer: "Birds build nests to keep their eggs safe." }),
    speak: async () => ({ audioContent: Buffer.from("speech").toString("base64"), format: "mp3" }),
    speakAsTommy: async () => ({ audioContent: Buffer.from("tommy-voice").toString("base64"), format: "mp3" }),
    transcribe: async () => "Why do birds build nests?",
  };
}

const T0 = Date.UTC(2026, 10, 27, 9, 0, 0);
const ask = (room, student, text = "Why do birds build nests?") => room.send(room.students[student], "ask_question", { text });

test("a linked room answers its own student, shares the answer, and another room picks it up", async () => {
  models();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world();
    const a = await w.room("100001", ["ada"]);
    const b = await w.room("100002", ["bo"]);

    assert.deepEqual(await a.send(a.host, "join_group", { code: "1234", lessonId: "animal-homes", lessonTitle: "Animal Homes" }), { ok: true, members: 1, lessonTitle: "Animal Homes" });
    assert.equal((await b.send(b.host, "join_group", { code: "1234", lessonId: "animal-homes", lessonTitle: "Animal Homes" })).members, 2);
    const wrong = await a.send(a.host, "join_group", { code: "1234", lessonId: "other", lessonTitle: "x" });
    assert.equal(wrong.ok, false);
    assert.equal((await a.send(a.host, "join_group", { code: "12", lessonId: "animal-homes" })).ok, false);
    assert.equal((await a.send(a.students.ada, "join_group", { code: "1234", lessonId: "animal-homes" })).ok, false, "a student cannot link the room");

    // Ada asks; her room makes the answer and her host gets it with addresses to the voice.
    const asked = await ask(a, "ada");
    assert.equal(asked.ok, true);
    const [own] = a.host.events("tutor_answer");
    assert.equal(own.name, "ada");
    assert.equal(own.answer, "Birds build nests to keep their eggs safe.");
    assert.match(own.audioUrl, /^\/uploads\/autoclass\/_tutor\/1234\/[0-9a-f-]+\.mp3$/);
    assert.match(own.questionAudioUrl, /^\/uploads\/autoclass\/_tutor\/1234\/[0-9a-f-]+\.mp3$/);
    assert.equal(own.audioContent, null, "no copy of the voice in the message");
    assert.equal(w.r2.objects.size, 2);
    assert.equal(w.r2.objects.get(own.audioUrl.slice(1)).options.httpMetadata.contentType, "audio/mpeg");
    assert.deepEqual(a.students.ada.events("ask_status").map((s) => s.state), ["answering"]);
    assert.deepEqual(b.host.events("tutor_answer"), [], "other rooms are not sent it");

    // Bo's room has no question of its own: it picks Ada's answer, once.
    const picked = await b.send(b.host, "group_pull", {});
    assert.equal(picked.ok, true);
    assert.equal(picked.members, 2);
    assert.equal(picked.answer.name, "ada");
    assert.equal(picked.answer.audioUrl, own.audioUrl);
    assert.equal((await b.send(b.host, "group_pull", {})).answer, null);
    assert.equal((await a.send(a.host, "group_pull", {})).answer, null, "never its own");

    // Leaving: the last room out clears the group and its sound files.
    assert.equal((await a.send(a.host, "leave_group", {})).ok, true);
    assert.equal((await a.send(a.host, "group_pull", {})).ok, false, "no longer linked");
    assert.equal(w.r2.objects.size, 2);
    await b.send(b.host, "leave_group", {});
    assert.equal(w.r2.objects.size, 0);
  } finally {
    mock.timers.reset();
  }
});

test("a room that is not linked answers as before, with the voice in the message", async () => {
  models();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world();
    const solo = await w.room("200001", ["ada"]);
    assert.equal((await ask(solo, "ada")).ok, true);
    const [answer] = solo.host.events("tutor_answer");
    assert.match(answer.audioContent, /^[A-Za-z0-9+/=]+$/);
    assert.equal("audioUrl" in answer, false);
    assert.equal(w.r2.objects.size, 0);
    assert.equal((await solo.send(solo.host, "group_pull", {})).ok, false);
  } finally {
    mock.timers.reset();
  }
});

test("a room's questions are answered one at a time, in order", async () => {
  models();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world();
    const a = await w.room("300001", ["ada", "bo"]);
    await a.send(a.host, "join_group", { code: "3333", lessonId: "animal-homes" });
    let calls = 0;
    globalThis.__ai.completeText = async () => {
      calls += 1;
      if (calls === 1) await gate;
      return JSON.stringify({ ok: true, question: `Question ${calls}?`, answer: `Answer ${calls}.` });
    };
    const first = ask(a, "ada", "first");
    await new Promise((resolve) => setImmediate(resolve));
    const second = await ask(a, "bo", "second");
    assert.equal(second.ok, true);
    assert.deepEqual(a.students.bo.events("ask_status").map((s) => s.state), ["queued"]);
    assert.equal(calls, 1, "the second waits for the first");
    release();
    await first;
    assert.deepEqual(a.host.events("tutor_answer").map((x) => x.answer), ["Answer 1.", "Answer 2."]);
  } finally {
    release();
    mock.timers.reset();
  }
});

test("past the group's rate a question waits its turn, then starts; one that waits too long is let go", async () => {
  models();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world();
    const a = await w.room("400001", ["ada"]);
    const b = await w.room("400002", ["bo"]);
    const c = await w.room("400003", ["cy"]);
    for (const room of [a, b, c]) await room.send(room.host, "join_group", { code: "4444", lessonId: "animal-homes", rate: 1 });
    const group = w.env.GROUP.getByName("4444");

    await ask(a, "ada");
    assert.equal(a.host.events("tutor_answer").length, 1, "the first starts at once");

    mock.timers.setTime(T0 + 1000);
    const waiting = ask(b, "bo");
    await waiting;
    assert.deepEqual(b.students.bo.events("ask_status").map((s) => s.state), ["queued"]);
    assert.equal(b.host.events("tutor_answer").length, 0);

    mock.timers.setTime(T0 + 61 * 1000);
    await group.alarm();
    assert.equal(b.host.events("tutor_answer").length, 1, "its turn came");
    assert.deepEqual(b.students.bo.events("ask_status").map((s) => s.state), ["queued", "answering"]);

    // Cy waits behind a full minute and nobody looks until two minutes have passed.
    mock.timers.setTime(T0 + 62 * 1000);
    await ask(c, "cy");
    assert.deepEqual(c.students.cy.events("ask_status").map((s) => s.state), ["queued"]);
    mock.timers.setTime(T0 + 62 * 1000 + 2 * 60 * 1000 + 1);
    await group.alarm();
    assert.deepEqual(c.students.cy.events("ask_status").map((s) => s.state), ["queued", "later"]);
    assert.equal(c.host.events("tutor_declined").length, 1);
    assert.equal(c.host.events("tutor_answer").length, 0);
    // Cy may ask again at once.
    mock.timers.setTime(T0 + 62 * 1000 + 2 * 60 * 1000 + 2);
    assert.equal((await ask(c, "cy")).ok, true);
  } finally {
    mock.timers.reset();
  }
});

test("the group's speech-to-text cap refuses a recording before it is turned into text", async () => {
  models();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world();
    const rooms = [];
    for (let i = 0; i < 22; i += 1) {
      const room = await w.room(`50${String(i).padStart(4, "0")}`, ["ada"]);
      await room.send(room.host, "join_group", { code: "5555", lessonId: "animal-homes", rate: 60 });
      rooms.push(room);
    }
    const results = [];
    for (const room of rooms) results.push((await ask(room, "ada")).ok);
    assert.equal(results.filter(Boolean).length, 20);
    assert.match((await ask(rooms[21], "ada")).error, /coming in/);
  } finally {
    mock.timers.reset();
  }
});

test("if the group is gone, a room carries on by itself", async () => {
  models();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world();
    const a = await w.room("600001", ["ada"]);
    await a.send(a.host, "join_group", { code: "6666", lessonId: "animal-homes" });
    // The group has been cleared (after its long life); the room still thinks it is linked.
    w.groups.get("6666").ctx.storage.sql.exec("DELETE FROM grp");
    w.groups.set("6666", new GroupDurableObject(fakeCtx(), w.env));
    assert.equal((await ask(a, "ada")).ok, true);
    const [answer] = a.host.events("tutor_answer");
    assert.equal(answer.answer, "Birds build nests to keep their eggs safe.");
    assert.equal("audioUrl" in answer, false, "no group, so the voice came the usual way");
  } finally {
    mock.timers.reset();
  }
});

test("fifty places at once: the group's limits hold, and every quiet place gets an answer to watch", async () => {
  models();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world();
    const rooms = [];
    for (let i = 0; i < 50; i += 1) {
      const room = await w.room(`70${String(i).padStart(4, "0")}`, ["ada"]);
      const joined = await room.send(room.host, "join_group", { code: "7777", lessonId: "animal-homes", rate: 10 });
      assert.equal(joined.ok, true);
      rooms.push(room);
    }
    assert.equal(w.groups.size, 1);

    // Everyone asks within the same minute: twenty recordings may be turned into text, ten answers
    // start at once, the other ten wait for a slot.
    const results = [];
    for (const room of rooms) results.push(await ask(room, "ada"));
    assert.equal(results.filter((r) => r.ok).length, 20);
    assert.equal(results.filter((r) => !r.ok && /coming in/.test(r.error)).length, 30);
    const answered = rooms.filter((room) => room.host.events("tutor_answer").length);
    assert.equal(answered.length, 10);
    const waiting = rooms.filter((room) => room.students.ada.events("ask_status").some((s) => s.state === "queued"));
    assert.equal(waiting.length, 10);

    // A minute on, the waiting ten start.
    mock.timers.setTime(T0 + 61 * 1000);
    await w.env.GROUP.getByName("7777").alarm();
    assert.equal(rooms.filter((room) => room.host.events("tutor_answer").length).length, 20);

    // The thirty places that could not ask each pick one answer, spread evenly over the twenty.
    const quiet = rooms.filter((room) => !room.host.events("tutor_answer").length);
    assert.equal(quiet.length, 30);
    const seen = {};
    for (const room of quiet) {
      const res = await room.send(room.host, "group_pull", {});
      assert.equal(res.ok, true);
      assert.ok(res.answer, "every quiet place gets one");
      seen[res.answer.askId] = (seen[res.answer.askId] || 0) + 1;
    }
    const counts = Object.values(seen);
    assert.equal(counts.length, 20, "each of the twenty answers is watched by someone");
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, JSON.stringify(seen));
    assert.equal(rooms[0].dobj.read().roomId, "700000");
  } finally {
    mock.timers.reset();
  }
});
