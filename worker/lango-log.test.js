import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { flushLogs, logClassActivity, logRuntime, logUsage, noteHost, observeApi, roomEventUsage } from "./lango-log.js";

const env = { LOG_INGEST_URL: "https://log.example/api/ingest", LOG_ENVIRONMENT: "production" };
const realFetch = globalThis.fetch;
let uploads;
let respond;

beforeEach(() => {
  uploads = [];
  respond = (body) => Response.json({ ok: true, accepted: body.events.map((event) => event.id) });
  noteHost("class.lango.ai");
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    uploads.push({ url, init, body });
    return respond(body);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const request = (method, path) => new Request(`https://class.lango.ai${path}`, { method });
const sent = () => uploads.flatMap((upload) => upload.body.events);

test("a 5xx API response becomes an anonymous api event with only allowlisted context", async () => {
  observeApi(env, null, request("POST", "/api/cms/generate-exercises?token=secret"), "/api/cms/generate-exercises", 502, 9000);
  await flushLogs();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].url, env.LOG_INGEST_URL);
  assert.equal(uploads[0].init.headers.authorization, undefined);
  const [event] = sent();
  assert.deepEqual(
    { category: event.category, code: event.code, level: event.level, platform: event.platform, environment: event.environment },
    { category: "api", code: "request_failed", level: "error", platform: "web", environment: "production" }
  );
  assert.deepEqual(event.context, { source: "class", method: "POST", path: "/api/cms/generate-exercises", status: 502, duration_ms: 9000 });
  assert.match(event.app_version, /^class-[\w.+-]+$/);
  assert.match(event.id, /^[\w.-]{1,100}$/);
  assert.match(event.code, /^[a-z][a-z0-9_]{0,59}$/);
});

test("paths with ids are redacted before they leave the Worker", async () => {
  observeApi(env, null, request("PUT", "/api/cms/courses/secret-course"), "/api/cms/courses/secret-course", 500, 12);
  await flushLogs();
  assert.equal(sent()[0].context.path, "/api/[redacted]");
  assert.ok(!JSON.stringify(uploads).includes("secret-course"));
});

test("503 is a warning and ordinary 2xx/4xx responses send nothing", async () => {
  observeApi(env, null, request("GET", "/api/lango/classList"), "/api/lango/classList", 503, 5);
  observeApi(env, null, request("GET", "/api/lango/classList"), "/api/lango/classList", 404, 5);
  observeApi(env, null, request("GET", "/api/lango/classList"), "/api/lango/classList", 200, 5);
  await flushLogs();
  assert.deepEqual(sent().map((event) => [event.code, event.level]), [["endpoint_unavailable", "warn"]]);
});

test("a successful host action counts as one registered feature use", async () => {
  observeApi(env, null, request("POST", "/api/session/start"), "/api/session/start", 200, 5);
  observeApi(env, null, request("POST", "/api/session/start"), "/api/session/start", 401, 5);
  observeApi(env, null, request("GET", "/api/cms/courses/abc/export"), "/api/cms/courses/abc/export", 200, 5);
  observeApi(env, null, request("POST", "/api/cms/generate-video"), "/api/cms/generate-video", 200, 5);
  await flushLogs();
  assert.deepEqual(
    sent().map((event) => [event.category, event.code, event.context.feature_id]),
    [["usage", "feature_clicked", "class_session_start"], ["usage", "feature_clicked", "class_course_export"], ["usage", "feature_clicked", "class_video_generate"]]
  );
  assert.ok(sent().every((event) => event.level === "info" && Object.keys(event.context).join() === "source,feature_id"));
});

test("room events log only host actions that were accepted", async () => {
  roomEventUsage(env, null, "create_room_game", { ok: true });
  roomEventUsage(env, null, "create_room_game", { ok: false, error: "Only the host can do this." });
  roomEventUsage(env, null, "submit_answer", { ok: true });
  roomEventUsage(env, null, "start_buzzin_round", undefined);
  await flushLogs();
  assert.deepEqual(sent().map((event) => event.context.feature_id), ["class_room_game_create", "class_buzzin_start"]);
});

test("unregistered feature ids are never sent", async () => {
  logUsage(env, null, "class_not_registered");
  await flushLogs();
  assert.equal(uploads.length, 0);
});

test("runtime errors keep only an allowlisted error name", async () => {
  logRuntime(env, null, "job_question_tts_failed", Object.assign(new Error("secret learner text"), { name: "TypeError" }));
  logRuntime(env, null, "scores_save_failed", Object.assign(new Error("x"), { name: "D1_ERROR" }));
  await flushLogs();
  assert.deepEqual(sent().map((event) => [event.category, event.code, event.context.error_name]), [
    ["runtime", "job_question_tts_failed", "TypeError"],
    ["runtime", "scores_save_failed", "Other"],
  ]);
  assert.ok(!JSON.stringify(uploads).includes("secret learner text"));
});

test("nothing is sent when unconfigured, disabled, or running on localhost", async () => {
  observeApi({}, null, request("GET", "/api/x"), "/api/x", 500, 1);
  observeApi({ ...env, LOG_ENABLED: "false" }, null, request("GET", "/api/x"), "/api/x", 500, 1);
  noteHost("localhost");
  observeApi(env, null, request("GET", "/api/x"), "/api/x", 500, 1);
  await flushLogs();
  assert.equal(uploads.length, 0);
});

test("the UAT environment is passed through", async () => {
  observeApi({ ...env, LOG_ENVIRONMENT: "uat" }, null, request("GET", "/api/scores"), "/api/scores", 500, 1);
  await flushLogs();
  assert.equal(sent()[0].environment, "uat");
});

test("events batch in twenties and a failed upload never throws", async () => {
  for (let index = 0; index < 45; index += 1) observeApi(env, null, request("GET", "/api/scores"), "/api/scores", 500, index);
  await flushLogs();
  assert.deepEqual(uploads.map((upload) => upload.body.events.length), [20, 20, 5]);

  respond = () => new Response("down", { status: 503 });
  const quiet = console.error;
  console.error = () => {};
  try {
    observeApi(env, null, request("GET", "/api/scores"), "/api/scores", 500, 1);
    await flushLogs();
  } finally {
    console.error = quiet;
  }
});

test("class activity goes to the keyed class ingest with its school, never a name", async () => {
  const entry = {
    sessionId: "class-room-123456-1000",
    schoolId: "abgps",
    teacherId: "835",
    code: "student_offline",
    level: "warn",
    context: { room_id: "123456", class_id: "62", class_name: "5A", student_code: "STU-0604", online_count: 27, roster_count: 29, student_name: "Ada Lam", end_reason: "nope" },
  };
  logClassActivity(env, null, [entry]);
  await flushLogs();
  assert.equal(uploads.length, 0, "nothing is sent without the class key");

  const keyed = { ...env, CLASS_LOG_API_KEY: "k".repeat(40) };
  logClassActivity(keyed, null, [entry]);
  await flushLogs();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].url, "https://log.example/api/class-ingest");
  assert.equal(uploads[0].init.headers.authorization, `Bearer ${"k".repeat(40)}`);
  const [event] = sent();
  assert.deepEqual(
    { session_id: event.session_id, school_id: event.school_id, teacher_id: event.teacher_id, category: event.category, code: event.code, level: event.level },
    { session_id: "class-room-123456-1000", school_id: "abgps", teacher_id: "835", category: "class", code: "student_offline", level: "warn" }
  );
  assert.deepEqual(event.context, { source: "class", room_id: "123456", class_id: "62", class_name: "5A", student_code: "STU-0604", online_count: 27, roster_count: 29 });

  noteHost("localhost");
  logClassActivity(keyed, null, [entry]);
  await flushLogs();
  assert.equal(uploads.length, 1, "local dev never reaches the live log");
});
