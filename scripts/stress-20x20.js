#!/usr/bin/env node
/**
 * Stress test: 20 classes × 20 students on a live Classroom server.
 *
 * Half the classes play MC at the same time the other half watch video.
 * Does NOT call POST /api/session/start (no student push notifications).
 *
 *   npm run stress:20x20
 *   node scripts/stress-20x20.js --url https://classroom.lango.ai
 *   node scripts/stress-20x20.js --classes 20 --students 20 --video-bytes 1572864
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");
const { io } = require("socket.io-client");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const TARGET = String(arg("url", "https://classroom.lango.ai")).replace(/\/$/, "");
const CLASS_COUNT = Math.max(2, Number(arg("classes", 20)) || 20);
const STUDENT_COUNT = Math.max(1, Number(arg("students", 20)) || 20);
const HOLD_MS = Math.max(0, Number(arg("hold-ms", 8000)) || 8000);
const JOIN_STAGGER_MS = Math.max(0, Number(arg("join-stagger-ms", 15)) || 15);
const ACK_TIMEOUT_MS = Math.max(1000, Number(arg("ack-timeout-ms", 15000)) || 15000);
const VIDEO_BYTES = Math.max(64 * 1024, Number(arg("video-bytes", 1.5 * 1024 * 1024)) || 1.5 * 1024 * 1024);
const VIDEO_CHUNK = Math.max(32 * 1024, Number(arg("video-chunk-bytes", 256 * 1024)) || 256 * 1024);
const VIDEO_URL_OVERRIDE = String(arg("video-url", "") || "").trim();
const VIDEO_VIEWERS = String(arg("video-viewers", "students") || "students");
const MC_QUESTIONS = Math.min(5, Math.max(1, Number(arg("mc-questions", 2)) || 2));

const DEFAULT_VIDEO_CANDIDATES = [
  `${TARGET}/uploads/videos/import-835-1786443755500-bs0gbw.mp4`,
  "https://s3.ap-east-1.amazonaws.com/langoappmaterial.uat/serverdev/ExerciseVideos/Story_In_the_sea/video-P1_Final.mp4",
];

const stats = {
  hostConnectMs: [],
  studentConnectMs: [],
  joinMs: [],
  answerMs: [],
  videoMs: [],
  videoBytes: 0,
  videoOk: 0,
  videoFail: 0,
  joinOk: 0,
  joinFail: 0,
  answersOk: 0,
  gamesFinished: 0,
  connectFail: 0,
  unexpectedDrops: 0,
  errors: [],
};

const allSockets = [];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function fmtMs(values) {
  if (!values.length) return "n/a";
  return `n=${values.length} p50=${percentile(values, 50)}ms p95=${percentile(values, 95)}ms p99=${percentile(values, 99)}ms max=${Math.max(...values)}ms`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordError(label, err) {
  const message = err?.message || String(err);
  stats.errors.push(`${label}: ${message}`);
  if (stats.errors.length <= 16) {
    console.error(`  ! ${label}: ${message}`);
  }
}

function connectSocket(label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const socket = io(TARGET, {
      transports: ["websocket"],
      upgrade: false,
      reconnection: false,
      timeout: 20000,
      forceNew: true,
    });

    const fail = (err) => {
      socket.removeAllListeners();
      socket.close();
      stats.connectFail += 1;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const timer = setTimeout(() => fail(new Error("connect timeout")), 20000);

    socket.once("connect", () => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (label === "host") stats.hostConnectMs.push(ms);
      else stats.studentConnectMs.push(ms);
      socket.on("disconnect", (reason) => {
        if (reason === "io client disconnect") return;
        stats.unexpectedDrops += 1;
        recordError(`${label} disconnect`, reason);
      });
      allSockets.push(socket);
      resolve(socket);
    });

    socket.once("connect_error", fail);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), ACK_TIMEOUT_MS);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function httpRequest(url, { method = "GET", headers = {}, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          "User-Agent": "lango-class-stress/1.0",
          ...headers,
        },
      },
      (res) => {
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, bytes, headers: res.headers });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`${method} timeout`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function resolveVideoUrl() {
  const candidates = VIDEO_URL_OVERRIDE ? [VIDEO_URL_OVERRIDE] : DEFAULT_VIDEO_CANDIDATES;
  for (const url of candidates) {
    try {
      const head = await httpRequest(url, { method: "HEAD", timeoutMs: 12000 });
      if (head.status >= 200 && head.status < 400) return url;
      const probe = await httpRequest(url, {
        method: "GET",
        headers: { Range: "bytes=0-1023" },
        timeoutMs: 12000,
      });
      if (probe.status >= 200 && probe.status < 400 && probe.bytes > 0) return url;
    } catch (err) {
      recordError("video probe", `${url} ${err.message || err}`);
    }
  }
  throw new Error("No playable video URL found. Pass --video-url");
}

async function streamVideoLikePlayer(url) {
  const started = Date.now();
  let offset = 0;
  let downloaded = 0;
  try {
    while (downloaded < VIDEO_BYTES) {
      const end = offset + VIDEO_CHUNK - 1;
      const res = await httpRequest(url, {
        method: "GET",
        headers: { Range: `bytes=${offset}-${end}` },
        timeoutMs: 25000,
      });
      if (res.status !== 200 && res.status !== 206) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.bytes) break;
      downloaded += res.bytes;
      offset += res.bytes;
      await sleep(80);
    }
    stats.videoOk += 1;
    stats.videoBytes += downloaded;
    stats.videoMs.push(Date.now() - started);
    return downloaded;
  } catch (err) {
    stats.videoFail += 1;
    stats.videoMs.push(Date.now() - started);
    throw err;
  }
}

function makeQuiz(classIndex) {
  const questions = [];
  for (let i = 0; i < MC_QUESTIONS; i += 1) {
    questions.push({
      text: `Stress MC Q${i + 1} class ${classIndex + 1}`,
      options: ["A", "B", "C", "D"],
      correctIndex: i % 4,
      timeLimit: 8,
    });
  }
  return {
    title: `Stress MC ${String(classIndex + 1).padStart(2, "0")}`,
    fastMode: true,
    questions,
  };
}

async function createHostedClass(classIndex, activity) {
  const host = await connectSocket("host");
  const created = await emitAck(host, "create_game", { quiz: makeQuiz(classIndex) });
  if (!created?.ok || !created.pin) {
    host.close();
    throw new Error(created?.error || "create_game failed");
  }

  host.on("question_speaking", ({ questionIndex }) => {
    host.emit("question_tts_done", { questionIndex });
  });

  return {
    host,
    pin: String(created.pin),
    classIndex,
    activity,
    students: [],
  };
}

async function joinStudent(room, studentIndex) {
  const nickname = `S${room.classIndex + 1}_${String(studentIndex + 1).padStart(2, "0")}`;
  const socket = await connectSocket("student");
  const started = Date.now();

  try {
    const res = await emitAck(socket, "join_game", { pin: room.pin, nickname });
    stats.joinMs.push(Date.now() - started);
    if (!res?.ok) {
      stats.joinFail += 1;
      socket.close();
      throw new Error(res?.error || "join failed");
    }
    stats.joinOk += 1;

    if (room.activity === "mc") {
      socket.on("question_start", ({ questionIndex }) => {
        const jitter = 20 + Math.floor(Math.random() * 180);
        setTimeout(() => {
          const t0 = Date.now();
          socket.emit("submit_answer", { answerIndex: Number(questionIndex) % 4 });
          socket.once("answer_received", () => {
            stats.answerMs.push(Date.now() - t0);
            stats.answersOk += 1;
          });
        }, jitter);
      });
    }

    return socket;
  } catch (err) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

async function fillClass(room) {
  for (let s = 0; s < STUDENT_COUNT; s += 1) {
    try {
      const socket = await joinStudent(room, s);
      room.students.push(socket);
    } catch (err) {
      recordError(`class ${room.classIndex + 1} student ${s + 1}`, err);
    }
    if (JOIN_STAGGER_MS) await sleep(JOIN_STAGGER_MS);
  }
}

function waitForGameFinished(host, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    host.once("game_finished", () => {
      clearTimeout(timer);
      stats.gamesFinished += 1;
      resolve("finished");
    });
    host.once("game_ended", () => {
      clearTimeout(timer);
      resolve("ended");
    });
  });
}

async function runMc(rooms) {
  if (!rooms.length) return;
  console.log(`Starting ${rooms.length} MC classes at once…`);
  const waits = rooms.map((room) => waitForGameFinished(room.host, 45000 + MC_QUESTIONS * 15000));
  for (const room of rooms) {
    room.host.emit("start_game");
  }
  await Promise.all(waits);
}

async function runVideo(rooms, videoUrl) {
  if (!rooms.length) return;
  const jobs = [];
  for (const room of rooms) {
    jobs.push(
      streamVideoLikePlayer(videoUrl).catch((err) => {
        recordError(`video host class ${room.classIndex + 1}`, err);
      })
    );
    if (VIDEO_VIEWERS !== "host") {
      for (let i = 0; i < room.students.length; i += 1) {
        jobs.push(
          sleep((i % 8) * 40).then(() =>
            streamVideoLikePlayer(videoUrl).catch((err) => {
              recordError(`video class ${room.classIndex + 1} student ${i + 1}`, err);
            })
          )
        );
      }
    }
  }
  console.log(`Starting video playback: ${jobs.length} viewers × ~${Math.round(VIDEO_BYTES / 1024)}KB`);
  await Promise.all(jobs);
}

function closeAll() {
  for (const socket of allSockets) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
}

function printReport({ mcCount, videoCount, videoUrl }) {
  console.log("\n=== stress 20×20 video+MC report ===");
  console.log(`target            ${TARGET}`);
  console.log(`classes           ${CLASS_COUNT} (${mcCount} MC + ${videoCount} video) × ${STUDENT_COUNT} students`);
  console.log(`video url         ${videoUrl || "n/a"}`);
  console.log(`join ok/fail      ${stats.joinOk}/${stats.joinFail}`);
  console.log(`connect fail      ${stats.connectFail}`);
  console.log(`unexpected drops  ${stats.unexpectedDrops}`);
  console.log(`host connect      ${fmtMs(stats.hostConnectMs)}`);
  console.log(`student connect   ${fmtMs(stats.studentConnectMs)}`);
  console.log(`join ack          ${fmtMs(stats.joinMs)}`);
  console.log(`MC finished       ${stats.gamesFinished}/${mcCount}`);
  console.log(`MC answers        ${stats.answersOk}`);
  console.log(`MC answer ack     ${fmtMs(stats.answerMs)}`);
  console.log(`video ok/fail     ${stats.videoOk}/${stats.videoFail}`);
  console.log(`video downloaded  ${(stats.videoBytes / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`video stream      ${fmtMs(stats.videoMs)}`);
  if (stats.errors.length) {
    console.log(`errors            ${stats.errors.length} (first 16 printed above)`);
  }
}

async function main() {
  if (hasFlag("quiz")) {
    console.log("Note: --quiz is implied. This run always plays MC and watches video together.");
  }

  const mcCount = Math.ceil(CLASS_COUNT / 2);
  const videoCount = CLASS_COUNT - mcCount;
  console.log(`Stress target: ${TARGET}`);
  console.log(`${CLASS_COUNT} classes × ${STUDENT_COUNT} students`);
  console.log(`Same time: ${mcCount} classes play MC, ${videoCount} classes watch video`);
  console.log("Hosts skip TTS wait with question_tts_done (server may still fire TTS once per question).");

  const startedAt = Date.now();
  const rooms = [];
  let videoUrl = "";

  try {
    videoUrl = await resolveVideoUrl();
    console.log(`Video: ${videoUrl}`);

    for (let i = 0; i < CLASS_COUNT; i += 1) {
      const activity = i < mcCount ? "mc" : "video";
      const room = await createHostedClass(i, activity);
      rooms.push(room);
      console.log(`Class ${i + 1}/${CLASS_COUNT} pin ${room.pin} (${activity})`);
      await fillClass(room);
      console.log(`  joined ${room.students.length}/${STUDENT_COUNT}`);
    }

    const mcRooms = rooms.filter((r) => r.activity === "mc");
    const videoRooms = rooms.filter((r) => r.activity === "video");
    console.log("All rooms ready. Starting MC + video together…");

    await Promise.all([runMc(mcRooms), runVideo(videoRooms, videoUrl)]);

    if (HOLD_MS) {
      console.log(`Holding sockets ${HOLD_MS}ms…`);
      await sleep(HOLD_MS);
    }

    console.log(`Elapsed ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } finally {
    closeAll();
    printReport({ mcCount, videoCount, videoUrl });
  }
}

main().catch((err) => {
  recordError("fatal", err);
  closeAll();
  printReport({
    mcCount: Math.ceil(CLASS_COUNT / 2),
    videoCount: Math.floor(CLASS_COUNT / 2),
    videoUrl: "",
  });
  process.exitCode = 1;
});
