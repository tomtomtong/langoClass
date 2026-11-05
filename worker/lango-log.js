// Sends diagnostics and feature use to the shared Lango log service
// (https://log.lango.ai/api/ingest) so class.lango.ai problems show beside the
// Lango 3.0 app's. That service accepts only a fixed allowlist: anonymous
// diagnostics carry codes and numbers, never room codes, names, messages or
// request bodies. Class room activity (logClassActivity) goes to the keyed
// /api/class-ingest with its school, room, class and student codes, never names.
// Best effort: a failure here never touches a request or a live class.
import { matchApiRoute } from "./api-routes.js";
import pkg from "../package.json" with { type: "json" };

const BATCH_MAX = 20;
const QUEUE_MAX = 200;
const FLUSH_DELAY_MS = 200;
const SEND_TIMEOUT_MS = 8000;
const BACKOFF_MS = 30 * 1000;
const ERROR_NAMES = new Set([
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AbortError", "NotAllowedError",
  "NotFoundError", "SecurityError", "InvalidStateError", "QuotaExceededError", "DataCloneError", "UnknownError",
]);

// Button/flow ids registered in Lango 3.0 shared/featureUsage.ts; an unknown id
// makes log.lango.ai refuse the whole batch.
const FEATURES = new Set([
  "class_host_login", "class_session_start", "class_session_end", "class_room_game_create", "class_exercise_start",
  "class_buzzin_start", "class_qr_join", "class_cms_open", "class_ai_generate", "class_course_import",
  "class_course_export", "class_video_generate",
]);
const API_USAGE = [
  ["POST", /^\/api\/lango\/login$/, "class_host_login"],
  ["POST", /^\/api\/session\/start$/, "class_session_start"],
  ["POST", /^\/api\/session\/end$/, "class_session_end"],
  ["GET", /^\/api\/join\/lookup$/, "class_qr_join"],
  ["GET", /^\/api\/cms\/app-context$/, "class_cms_open"],
  ["POST", /^\/api\/cms\/(generate-exercises|batch-generate-exercises|generate-course-from-plan|revise-exercises|assistant)$/, "class_ai_generate"],
  ["POST", /^\/api\/cms\/courses\/(import-all|import-one)(\/init)?$/, "class_course_import"],
  ["GET", /^\/api\/cms\/courses\/(export-all|[^/]+\/export)$/, "class_course_export"],
  ["POST", /^\/api\/cms\/export-exercises-json$/, "class_course_export"],
  ["POST", /^\/api\/(cms\/generate-video|video)$/, "class_video_generate"],
];
// Room WebSocket events that mark a host action.
const ROOM_USAGE = {
  create_room_game: "class_room_game_create",
  start_next_exercise: "class_exercise_start",
  start_buzzin_round: "class_buzzin_start",
};

// Anonymous diagnostics go to /api/ingest. Class room activity goes to the
// keyed /api/class-ingest, which alone may name a school (class-activity.js).
const channel = () => ({ queue: [], flushing: null, backoffUntil: 0 });
const anonymous = channel();
const classroom = channel();
let sessionId = null; // random values are not allowed in global scope; made on first use
let localHost = false;

// `wrangler dev` runs on localhost; those runs must not reach the live log.
export function noteHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  localHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

export function logUsage(env, ctx, featureId) {
  if (FEATURES.has(featureId)) record(env, ctx, { category: "usage", code: "feature_clicked", level: "info", context: { feature_id: featureId } });
}

export function roomEventUsage(env, ctx, event, ack) {
  const feature = ROOM_USAGE[event];
  if (feature && ack?.ok !== false) logUsage(env, ctx, feature);
}

export function logRuntime(env, ctx, code, error, level = "error") {
  record(env, ctx, { category: "runtime", code, level, context: { error_name: errorName(error) } });
}

// Called for every /api response: failures become events, and a successful
// host action counts as one use of that feature.
export function observeApi(env, ctx, request, pathname, status, durationMs) {
  if (status >= 500) {
    const unavailable = status === 503;
    record(env, ctx, {
      category: "api",
      code: unavailable ? "endpoint_unavailable" : "request_failed",
      level: unavailable ? "warn" : "error",
      context: { method: request.method, path: routePath(request.method, pathname), status, duration_ms: durationMs },
    });
    return;
  }
  if (status >= 200 && status < 300) {
    const hit = API_USAGE.find(([method, pattern]) => method === request.method && pattern.test(pathname));
    if (hit) logUsage(env, ctx, hit[2]);
  }
}

// Only fixed routes are named; ids in a path never leave the Worker.
function routePath(method, pathname) {
  const route = matchApiRoute(method, pathname);
  return route && !route.path.includes(":") ? route.path : "/api/[redacted]";
}

function errorName(error) {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "Error";
  return ERROR_NAMES.has(name) ? name : "Other";
}

function settings(env) {
  const url = String(env?.LOG_INGEST_URL || "").trim();
  if (!url || localHost || String(env?.LOG_ENABLED || "").toLowerCase() === "false") return null;
  return { url, headers: {}, environment: String(env?.LOG_ENVIRONMENT || "").toLowerCase() === "uat" ? "uat" : "production" };
}

function classSettings(env) {
  const base = settings(env);
  const key = String(env?.CLASS_LOG_API_KEY || "").trim();
  if (!base || !key) return null;
  const url = String(env?.CLASS_LOG_INGEST_URL || "").trim() || base.url.replace(/\/api\/ingest$/, "/api/class-ingest");
  return { ...base, url, headers: { authorization: `Bearer ${key}` } };
}

// Room activity from class-activity.js: who is in which class at which
// school. Students are named by student code only.
export function logClassActivity(env, ctx, entries) {
  try {
    const config = classSettings(env);
    if (!config || !entries?.length) return;
    for (const entry of entries) {
      classroom.queue.push({
        ...baseEvent(config),
        session_id: entry.sessionId,
        level: entry.level,
        category: "class",
        code: entry.code,
        context: cleanClass(entry.context),
        school_id: entry.schoolId || "",
        teacher_id: entry.teacherId || "",
      });
    }
    send(classroom, config, ctx, entries.some((entry) => entry.level === "error"));
  } catch {
    // Diagnostics must never break a room.
  }
}

function cleanClass(context) {
  const out = { source: "class" };
  for (const [key, value] of Object.entries(context || {})) {
    if (key === "room_id" && /^\d{6}$/.test(value)) out[key] = value;
    else if ((key === "class_id" || key === "student_code") && /^[\w.-]{1,100}$/.test(String(value ?? ""))) out[key] = String(value);
    else if (key === "class_name" && typeof value === "string" && /^[^\u0000-\u001f\u007f<>]{1,40}$/.test(value.trim())) out[key] = value.trim();
    else if ((key === "online_count" || key === "roster_count") && Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
    else if (key === "end_reason" && (value === "teacher" || value === "teacher_offline")) out[key] = value;
  }
  return out;
}

function baseEvent(config) {
  return {
    id: crypto.randomUUID(),
    occurred_at: Date.now(),
    environment: config.environment,
    platform: "web",
    app_version: `class-${pkg.version}`.replace(/[^\w.+-]/g, "_").slice(0, 40),
  };
}

function send(target, config, ctx, urgent) {
  if (target.queue.length > QUEUE_MAX) target.queue.splice(0, target.queue.length - QUEUE_MAX);
  if (!target.flushing) target.flushing = flush(target, config, urgent ? 0 : FLUSH_DELAY_MS).finally(() => (target.flushing = null));
  // Every caller extends its own request's life so the upload can finish.
  ctx?.waitUntil?.(target.flushing);
}

function clean(context) {
  const out = { source: "class" };
  for (const [key, value] of Object.entries(context || {})) {
    if (key === "feature_id" && FEATURES.has(value)) out[key] = value;
    else if (key === "method" && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value)) out[key] = value;
    else if (key === "path" && typeof value === "string" && /^\/api\/[\w/.\-[\]]{1,80}$/.test(value)) out[key] = value;
    else if (key === "error_name" && typeof value === "string") out[key] = ERROR_NAMES.has(value) ? value : "Other";
    else if ((key === "status" || key === "duration_ms") && Number.isFinite(value) && value >= 0 && value <= 1e9) out[key] = Math.round(value);
  }
  return out;
}

function record(env, ctx, input) {
  try {
    const config = settings(env);
    if (!config) return;
    anonymous.queue.push({
      ...baseEvent(config),
      session_id: (sessionId ||= `class-${crypto.randomUUID()}`),
      level: input.level,
      category: input.category,
      code: input.code,
      context: clean(input.context),
    });
    send(anonymous, config, ctx, input.level === "error");
  } catch {
    // Diagnostics must never break a request.
  }
}

// Settles when the queue is empty or a send fails. Exported for tests.
export async function flushLogs() {
  await Promise.all([anonymous.flushing, classroom.flushing]);
}

async function flush(target, config, delayMs) {
  const { queue } = target;
  // Even for errors, wait one tick so events raised together share a batch.
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  while (queue.length && Date.now() >= target.backoffUntil) {
    const batch = queue.splice(0, BATCH_MAX);
    try {
      // Diagnostics carry no Authorization (anonymous, like a guest's); class
      // activity carries the shared class key and nothing else.
      const response = await fetch(config.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...config.headers },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      // The service refuses a malformed batch for good; resending cannot help.
      if ([400, 413, 415].includes(response.status)) {
        console.error(JSON.stringify({ message: "lango_log_rejected", status: response.status, events: batch.length }));
        continue;
      }
      const receipt = response.ok ? await response.json() : null;
      if (receipt?.ok !== true || !Array.isArray(receipt.accepted)) throw new Error(`log upload failed (${response.status})`);
      const accepted = new Set(receipt.accepted);
      const missed = batch.filter((event) => !accepted.has(event.id));
      if (missed.length) {
        queue.unshift(...missed);
        target.backoffUntil = Date.now() + BACKOFF_MS;
      }
    } catch (error) {
      queue.unshift(...batch);
      if (queue.length > QUEUE_MAX) queue.splice(QUEUE_MAX);
      target.backoffUntil = Date.now() + BACKOFF_MS;
      console.error(JSON.stringify({ message: "lango_log_failed", error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
