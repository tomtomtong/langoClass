#!/usr/bin/env node
/**
 * Load test for the Worker's class rooms (Durable Object + WebSocket).
 *
 * Opens R rooms, joins S students in each, then starts every room's quiz at the
 * same moment and plays it through with simulated answers. Reports connect,
 * join, answer and broadcast latency, and every error. Needs Node 22+ (global
 * WebSocket); no packages.
 *
 *   node scripts/stress-rooms.mjs --url http://localhost:8787 --rooms 5 --students 30
 *   STRESS_LOGIN=... STRESS_PASSWORD=... node scripts/stress-rooms.mjs \
 *     --url https://class.lango.ai --confirm --rooms 20 --students 30
 *
 * Auth: STRESS_TOKEN (+ STRESS_TEACHER_ID), or STRESS_LOGIN + STRESS_PASSWORD
 * for POST /api/lango/login.
 *
 * Against a real deployment this opens real rooms, writes a few score rows to D1
 * under class ids "stress-*", and (unless --fast) makes the room ask the speech
 * model to read each question once per room. Pass --confirm to allow it.
 *
 * Options:
 *   --url <origin>         Worker origin (default http://localhost:8787)
 *   --rooms <n>            Rooms at once (default 5)
 *   --students <n>         Students per room (default 30)
 *   --questions <n>        Questions per quiz (default 3)
 *   --fast                 Fast-mode quiz: no speech, no results screen
 *   --answer-min-ms <n>    Earliest a student answers (default 500)
 *   --answer-max-ms <n>    Latest a student answers (default 4000)
 *   --join-stagger-ms <n>  Gap between students joining a room (default 10)
 *   --room-stagger-ms <n>  Gap between rooms opening (default 100)
 *   --hold-ms <n>          Pause with everyone in the lobby before starting (default 2000)
 *   --timeout-ms <n>       Give up on the whole run after this long (default 300000)
 *   --json                 Print the summary as JSON
 *   --confirm              Required for any host other than localhost
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i + 1 >= args.length ? fallback : args[i + 1];
};
const num = (name, fallback, min = 0) => Math.max(min, Number(arg(name, fallback)) || fallback);
const flag = (name) => args.includes(`--${name}`);

const BASE = String(arg("url", "http://localhost:8787")).replace(/\/+$/, "");
const ROOMS = num("rooms", 5, 1);
const STUDENTS = num("students", 30, 1);
const QUESTIONS = num("questions", 3, 1);
const FAST = flag("fast");
const ANSWER_MIN = num("answer-min-ms", 500);
const ANSWER_MAX = Math.max(ANSWER_MIN, num("answer-max-ms", 4000));
const JOIN_STAGGER = num("join-stagger-ms", 10);
const ROOM_STAGGER = num("room-stagger-ms", 100);
const HOLD_MS = num("hold-ms", 2000);
const RUN_TIMEOUT = num("timeout-ms", 300000, 1000);
const ACK_TIMEOUT = 15000;
const QUESTION_SECONDS = 20;
const RUN_ID = Date.now().toString(36);

const host = new URL(BASE).hostname;
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(host) || host.endsWith(".localhost");
if (!isLocal && !flag("confirm")) {
  console.error(`Refusing to load ${BASE}: it opens real rooms and may call the speech model. Re-run with --confirm.`);
  process.exit(2);
}
if (typeof WebSocket === "undefined") {
  console.error("This needs Node 22+ (global WebSocket).");
  process.exit(2);
}

const wsBase = BASE.replace(/^http/, "ws");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => performance.now();

const metrics = {
  startRoomMs: [],
  hostConnectMs: [],
  studentConnectMs: [],
  joinAckMs: [],
  gameJoinAckMs: [],
  answerAckMs: [],
  questionFanoutMs: [],
  resultsFanoutMs: [],
};
const problems = new Map();
const counters = { sockets: 0, peakOpen: 0, open: 0, unexpectedCloses: 0, answersSent: 0, answersAcked: 0, roomsFinished: 0, roomsFailed: 0 };
const allClients = new Set();
const openedRooms = [];
let shuttingDown = false;

function problem(kind, detail = "") {
  const key = detail ? `${kind}: ${detail}` : kind;
  problems.set(key, (problems.get(key) || 0) + 1);
}

// ---- A WebSocket that speaks the room protocol ----------------------------

class Client {
  constructor(ws, label) {
    this.ws = ws;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.expectedClose = false;
    ws.addEventListener("message", (event) => this.#onMessage(event));
    ws.addEventListener("close", () => this.#onClose());
    ws.addEventListener("error", () => {});
  }

  static async connect(roomId, label) {
    const started = now();
    const ws = new WebSocket(`${wsBase}/api/room/${roomId}/ws`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("connect timeout")), ACK_TIMEOUT);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("connect error"));
      }, { once: true });
    });
    const client = new Client(ws, label);
    client.connectMs = now() - started;
    counters.sockets += 1;
    counters.open += 1;
    counters.peakOpen = Math.max(counters.peakOpen, counters.open);
    allClients.add(client);
    return client;
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  // Sends an event and resolves with the ack; { ack: false } for events the room never answers.
  emit(event, data = {}, { ack = true, timeoutMs = ACK_TIMEOUT } = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ t: "emit", id, event, data }));
    if (!ack) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${event} ack timeout`));
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
    });
  }

  close() {
    this.expectedClose = true;
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }

  #onMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (message.t === "ack") {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(message.id);
      waiting.resolve(message.data);
    } else if (message.t === "event") {
      this.handlers.get(message.event)?.(message.data);
    }
  }

  #onClose() {
    counters.open -= 1;
    for (const { timer, resolve } of this.pending.values()) {
      clearTimeout(timer);
      resolve({ ok: false, error: "socket closed" });
    }
    this.pending.clear();
    if (!this.expectedClose && !shuttingDown) {
      counters.unexpectedCloses += 1;
      problem("unexpected socket close", this.label.split(":")[0]);
    }
  }
}

// ---- HTTP -----------------------------------------------------------------

async function login() {
  if (process.env.STRESS_TOKEN) {
    return { token: process.env.STRESS_TOKEN, teacherId: process.env.STRESS_TEACHER_ID || "" };
  }
  const { STRESS_LOGIN: loginName, STRESS_PASSWORD: password } = process.env;
  if (!loginName || !password) {
    throw new Error("Set STRESS_TOKEN (+ STRESS_TEACHER_ID) or STRESS_LOGIN and STRESS_PASSWORD.");
  }
  const response = await fetch(`${BASE}/api/lango/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: loginName, password }),
  });
  const body = await response.json().catch(() => ({}));
  const token = body.token || body.user?.token;
  if (!response.ok || !token) throw new Error(`Login failed (${response.status}).`);
  return { token, teacherId: String(body.user?.id ?? "") };
}

function authHeaders(auth) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${auth.token}` };
  if (auth.teacherId) headers["x-teacher-id"] = String(auth.teacherId);
  return headers;
}

async function openRoom(auth, index) {
  const started = now();
  const response = await fetch(`${BASE}/api/session/start`, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({
      class: { id: `stress-${RUN_ID}-${index}`, name: `Stress ${RUN_ID} #${index}`, studentList: [] },
      user: { id: auth.teacherId || "stress" },
      uiLocale: "en",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.roomId) throw new Error(`session/start ${response.status} ${body.message || ""}`.trim());
  metrics.startRoomMs.push(now() - started);
  openedRooms.push(body.roomId);
  return body.roomId;
}

async function endRoom(auth, roomId) {
  try {
    await fetch(`${BASE}/api/session/end`, {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ roomId }),
    });
  } catch {
    problem("could not end room", roomId);
  }
}

// ---- One room -------------------------------------------------------------

function makeQuiz() {
  return {
    title: "Stress quiz",
    fastMode: FAST,
    questions: Array.from({ length: QUESTIONS }, (_, i) => ({
      text: `Stress question ${i + 1}: which option is right?`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: i % 4,
      timeLimit: QUESTION_SECONDS,
    })),
  };
}

const checkAck = (ack, what) => {
  if (!ack || ack.ok === false) throw new Error(`${what}: ${ack?.error || "no ack"}`);
  return ack;
};

// Phase 1: everyone in the lobby with the quiz ready. Returns a function that
// plays the game (phase 2) once the caller says go.
async function prepareRoom(auth, index) {
  const roomId = await openRoom(auth, index);
  const label = `room ${roomId}`;
  const hostClient = await Client.connect(roomId, `host:${label}`);
  metrics.hostConnectMs.push(hostClient.connectMs);
  checkAck(await hostClient.emit("host_session", { uiLocale: "en" }), "host_session");

  const students = [];
  const joins = Array.from({ length: STUDENTS }, async (_, i) => {
    await sleep(i * JOIN_STAGGER);
    const userId = `s${index}x${i}`;
    const client = await Client.connect(roomId, `student:${label}`);
    metrics.studentConnectMs.push(client.connectMs);
    const started = now();
    checkAck(await client.emit("join_session", { userId, displayName: `Stress ${index}-${i}` }), "join_session");
    metrics.joinAckMs.push(now() - started);
    students.push({ client, userId });
  });
  const joined = await Promise.allSettled(joins);
  for (const result of joined) if (result.status === "rejected") problem("student join failed", result.reason?.message);

  checkAck(
    await hostClient.emit("select_session_exercise", { exercise: { id: `stress-${RUN_ID}`, name: "Stress quiz", type: "quiz" } }),
    "select_session_exercise"
  );
  checkAck(await hostClient.emit("start_session"), "start_session");
  checkAck(await hostClient.emit("create_room_game", { quiz: makeQuiz() }), "create_room_game");

  await Promise.allSettled(
    students.map(async ({ client, userId }) => {
      const started = now();
      try {
        checkAck(await client.emit("join_room_game", { userId }), "join_room_game");
        metrics.gameJoinAckMs.push(now() - started);
      } catch (error) {
        problem("student join_room_game failed", error.message);
      }
    })
  );

  return () => playRoom({ roomId, hostClient, students });
}

// Phase 2: start the quiz and answer every question.
function playRoom({ roomId, hostClient, students }) {
  const game = { questionSeen: new Map(), lastAnswerSent: new Map(), answered: new Map() };

  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error(`room ${roomId} did not finish`)), RUN_TIMEOUT);
    const finish = () => {
      clearTimeout(guard);
      resolve();
    };

    hostClient.on("question_speaking", (data) => {
      hostClient.emit("question_tts_done", { questionIndex: data.questionIndex }, { ack: false });
    });
    hostClient.on("question_results", async () => {
      await sleep(500);
      hostClient.emit("next_question", {}, { ack: false });
    });
    hostClient.on("game_finished", finish);

    for (const { client, userId } of students) {
      client.on("question_start", (data) => {
        const q = data.questionIndex;
        const seen = game.questionSeen.get(q) || [];
        seen.push(now());
        game.questionSeen.set(q, seen);
        if (seen.length === students.length) {
          metrics.questionFanoutMs.push(Math.max(...seen) - Math.min(...seen));
        }
        const delay = ANSWER_MIN + Math.random() * (ANSWER_MAX - ANSWER_MIN);
        setTimeout(() => {
          const sent = now();
          game.lastAnswerSent.set(q, sent);
          counters.answersSent += 1;
          client.emit("submit_answer", { answerIndex: Math.floor(Math.random() * 4) }, { ack: false });
          client.answerSentAt = sent;
        }, delay);
      });
      client.on("answer_received", () => {
        counters.answersAcked += 1;
        if (client.answerSentAt) metrics.answerAckMs.push(now() - client.answerSentAt);
      });
      client.on("question_results", (data) => {
        const q = data.questionIndex;
        const answered = (game.answered.get(q) || 0) + 1;
        game.answered.set(q, answered);
        const sentAt = game.lastAnswerSent.get(q);
        if (sentAt && answered === 1) metrics.resultsFanoutMs.push(now() - sentAt);
      });
    }

    hostClient
      .emit("start_room_game")
      .then((ack) => checkAck(ack, "start_room_game"))
      .catch((error) => {
        clearTimeout(guard);
        reject(error);
      });
  });
}

// ---- Run ------------------------------------------------------------------

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const r = (v) => (v == null ? null : Math.round(v));
  return {
    n: sorted.length,
    p50: r(percentile(sorted, 50)),
    p95: r(percentile(sorted, 95)),
    p99: r(percentile(sorted, 99)),
    max: r(sorted[sorted.length - 1] ?? null),
  };
}

async function cleanup(auth) {
  shuttingDown = true;
  for (const client of allClients) client.close();
  await Promise.allSettled(openedRooms.map((roomId) => endRoom(auth, roomId)));
}

function report(elapsedMs) {
  const table = {
    "open room (HTTP)": summarize(metrics.startRoomMs),
    "host connect": summarize(metrics.hostConnectMs),
    "student connect": summarize(metrics.studentConnectMs),
    "join_session ack": summarize(metrics.joinAckMs),
    "join_room_game ack": summarize(metrics.gameJoinAckMs),
    "answer -> answer_received": summarize(metrics.answerAckMs),
    "question_start spread in room": summarize(metrics.questionFanoutMs),
    "last answer -> results arrives": summarize(metrics.resultsFanoutMs),
  };
  const summary = {
    config: { url: BASE, rooms: ROOMS, students: STUDENTS, questions: QUESTIONS, fast: FAST },
    elapsedSeconds: Math.round(elapsedMs / 1000),
    sockets: counters.sockets,
    peakOpenSockets: counters.peakOpen,
    roomsFinished: counters.roomsFinished,
    roomsFailed: counters.roomsFailed,
    unexpectedCloses: counters.unexpectedCloses,
    answersSent: counters.answersSent,
    answersConfirmed: counters.answersAcked,
    latencyMs: table,
    problems: Object.fromEntries(problems),
  };
  if (flag("json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`\n${ROOMS} rooms x ${STUDENTS} students (${counters.peakOpen} sockets at peak) against ${BASE}`);
  console.log(`rooms finished ${counters.roomsFinished}/${ROOMS}, unexpected closes ${counters.unexpectedCloses}, answers confirmed ${counters.answersAcked}/${counters.answersSent}, ${summary.elapsedSeconds}s\n`);
  console.log("latency (ms)".padEnd(34), "n".padStart(6), "p50".padStart(7), "p95".padStart(7), "p99".padStart(7), "max".padStart(7));
  for (const [name, s] of Object.entries(table)) {
    console.log(name.padEnd(34), String(s.n).padStart(6), String(s.p50 ?? "-").padStart(7), String(s.p95 ?? "-").padStart(7), String(s.p99 ?? "-").padStart(7), String(s.max ?? "-").padStart(7));
  }
  if (problems.size) {
    console.log("\nproblems:");
    for (const [key, count] of problems) console.log(`  ${count} x ${key}`);
  } else {
    console.log("\nno problems");
  }
}

async function main() {
  const auth = await login();
  const started = now();
  process.on("SIGINT", async () => {
    console.error("\nInterrupted: closing rooms...");
    await cleanup(auth);
    report(now() - started);
    process.exit(130);
  });

  console.log(`Opening ${ROOMS} rooms of ${STUDENTS} students on ${BASE}...`);
  const preparations = await Promise.allSettled(
    Array.from({ length: ROOMS }, async (_, index) => {
      await sleep(index * ROOM_STAGGER);
      return prepareRoom(auth, index);
    })
  );
  const plays = [];
  for (const result of preparations) {
    if (result.status === "fulfilled") plays.push(result.value);
    else {
      counters.roomsFailed += 1;
      problem("room setup failed", result.reason?.message);
    }
  }

  console.log(`Lobbies ready (${counters.open} sockets open). Starting ${plays.length} quizzes together in ${HOLD_MS}ms...`);
  await sleep(HOLD_MS);
  const finished = await Promise.allSettled(plays.map((play) => play()));
  for (const result of finished) {
    if (result.status === "fulfilled") counters.roomsFinished += 1;
    else {
      counters.roomsFailed += 1;
      problem("room did not finish", result.reason?.message);
    }
  }

  await cleanup(auth);
  report(now() - started);
  process.exit(counters.roomsFailed || counters.unexpectedCloses ? 1 : 0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
