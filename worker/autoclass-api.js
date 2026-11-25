// Autoclass lesson API (docs/autoclass-step2-plan.md). Like the page, it exists only while the
// Worker has AUTOCLASS=1 (autoclass-page.js).
//
//   PUT  /api/autoclass/lessons/:id          teacher  save a lesson script (400 with errors if invalid)
//   GET  /api/autoclass/lessons/:id          teacher  the script, the latest render, the published one
//   POST /api/autoclass/lessons/:id/render   teacher  render the saved script → { jobId, status }
//   POST /api/autoclass/lessons/:id/cleanup  teacher  remove old render folders now (autoclass-cleanup.js)
//   GET  /api/autoclass/jobs/:jobId          teacher  render status (as the lecture video jobs)
//   GET  /api/autoclass/lessons/:id/cues     anyone   the published cues, for /autoclass.html?lesson=<id>
//   PUT  /api/autoclass/lessons/:id/local-render/:renderId/files/<path>   teacher  one file of a render made
//        on the teacher's own computer (scripts/autoclass-render-local.mjs): the video, mp3s, cues.json
//   POST /api/autoclass/lessons/:id/local-render/:renderId/publish        teacher  point the lesson at it
//   PUT  /api/autoclass/media/:name          teacher  upload a quiz picture or sound clip (the raw
//                                                     bytes) to /uploads/autoclass/_media/<name>; up to 20 MB
import { autoclassEnabled } from "./autoclass-page.js";
import { json, readJson, requireTeacher, sameId } from "./d1-store.js";
import { VOICE_CACHE_PREFIX, publishRender, readLesson, renderFolder, scriptHash, writeLesson } from "./autoclass-lessons.js";
import { MEDIA_FOLDER, MEDIA_NAME, isLessonId, lessonWarnings, spokenLines, validateLessonScript } from "../lib/autoclass-script.mjs";
import { cleanLessonRenders } from "./autoclass-cleanup.js";
import { storeUpload } from "./course-files.js";
import { SAFE_NAME } from "./autoclass-job.js";
import { putStream } from "./video-job.js";

const TERMINAL = new Set(["completed", "failed", "missing"]);
const JOB_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function autoclassRoute(method, pathname) {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  let m = path.match(/^\/api\/autoclass\/lessons\/([^/]+)(?:\/(render|cues|cleanup))?$/);
  if (m) {
    const [, id, sub] = m;
    if (!sub && (method === "PUT" || method === "GET")) return { kind: method === "PUT" ? "save" : "read", id };
    if (sub === "render" && method === "POST") return { kind: "render", id };
    if (sub === "cleanup" && method === "POST") return { kind: "cleanup", id };
    if (sub === "cues" && (method === "GET" || method === "HEAD")) return { kind: "cues", id };
    return { kind: "method" };
  }
  m = path.match(/^\/api\/autoclass\/lessons\/([^/]+)\/local-render\/([A-Za-z0-9_-]{8,80})\/(files\/.+|publish)$/);
  if (m) {
    const [, id, renderId, rest] = m;
    if (rest === "publish") return method === "POST" ? { kind: "local-publish", id, renderId } : { kind: "method" };
    return method === "PUT" ? { kind: "local-file", id, renderId, name: decodeSafe(rest.slice("files/".length)) } : { kind: "method" };
  }
  m = path.match(/^\/api\/autoclass\/media\/([^/]+)$/);
  if (m) return method === "PUT" ? { kind: "media", name: m[1] } : { kind: "method" };
  m = path.match(/^\/api\/autoclass\/jobs\/([^/]+)$/);
  if (m) return method === "GET" ? { kind: "job", jobId: m[1] } : { kind: "method" };
  if (path === "/api/autoclass" || path.startsWith("/api/autoclass/")) return { kind: "missing" };
  return null;
}

export async function handleAutoclassApi(request, env, url) {
  const route = autoclassRoute(request.method, url.pathname);
  if (!route) return null;
  if (!autoclassEnabled(env)) return json({ message: "Not found." }, 404);
  if (route.kind === "missing") return json({ message: "Not found." }, 404);
  if (route.kind === "method") return json({ message: "Method not allowed." }, 405);
  if (route.id != null && !isLessonId(route.id)) return json({ message: "Lesson ids are 1–60 lowercase letters, digits or dashes." }, 400);

  if (route.kind === "cues") return publishedCues(env, route.id);

  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  if (route.kind === "media") return saveMedia(request, env, route.name);
  if (route.kind === "local-file") return saveLocalRenderFile(request, env, auth, route);
  if (route.kind === "local-publish") return publishLocalRender(env, auth, route);
  if (route.kind === "save") return saveLesson(request, env, auth, route.id);
  if (route.kind === "read") return readLessonApi(env, auth, route.id);
  if (route.kind === "cleanup") {
    const lesson = await ownLesson(env, auth, route.id);
    if (lesson instanceof Response) return lesson;
    return json({ ok: true, ...(await cleanLessonRenders(env, route.id)) });
  }
  if (route.kind === "render") return startRender(env, auth, route.id, publicOrigin(env, url));
  return jobStatus(env, auth, route.jobId);
}

async function saveLesson(request, env, auth, id) {
  const body = await readJson(request);
  const input = body && typeof body.script === "object" ? body.script : body;
  if (input && typeof input === "object" && input.id == null) input.id = id;
  const checked = validateLessonScript(input);
  if (!checked.ok) return json({ message: "The lesson script has problems.", errors: checked.errors }, 400);
  if (input.id !== id) return json({ message: `The script's id is "${input.id}", not "${id}".` }, 400);
  const existing = await readLesson(env, id);
  if (existing && !sameId(existing.teacherId, auth.teacherId)) return json({ message: "Another teacher already has a lesson with this id." }, 403);
  const now = new Date().toISOString();
  const lesson = { ...(existing || { id, teacherId: auth.teacherId, createdAt: now }), script: input, updatedAt: now };
  await writeLesson(env, lesson);
  // Not errors: the lesson is saved. They tell the author where it strays from docs/autoclass-lesson-rules.md.
  return json({ ok: true, lesson: await lessonView(env, lesson), warnings: lessonWarnings(checked.script) }, existing ? 200 : 201);
}

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
// One file of a render made on the teacher's computer: the see-through video is about 65 MB.
const MAX_LOCAL_FILE_BYTES = 150 * 1024 * 1024;
const LOCAL_TYPES = { mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", json: "application/json" };

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

// A render made on the teacher's own computer (much faster than the container) is uploaded file by
// file, then published. The names are the ones the renderer lists (SAFE_NAME); lines Tommy voiced
// fresh (_voice/<key>.mp3) go into the shared voice cache, as for a container render.
async function saveLocalRenderFile(request, env, auth, { id, renderId, name }) {
  const lesson = await ownLesson(env, auth, id);
  if (lesson instanceof Response) return lesson;
  if (!env.UPLOADS) return json({ message: "File storage is not configured." }, 500);
  if (!SAFE_NAME.test(name)) return json({ message: "That file name is not allowed." }, 400);
  const size = Number(request.headers.get("content-length") || 0);
  if (!size) return json({ message: "The file is empty (send a Content-Length)." }, 400);
  if (size > MAX_LOCAL_FILE_BYTES) return json({ message: "At most 150 MB per file." }, 413);
  const key = name.startsWith("_voice/")
    ? `${VOICE_CACHE_PREFIX}/${name.slice("_voice/".length)}`
    : `${renderFolder(id, renderId).key}/${name}`;
  const type = LOCAL_TYPES[name.split(".").pop()] || "application/octet-stream";
  await putStream(env.UPLOADS, key, request, type);
  return json({ ok: true, name, size }, 201);
}

async function publishLocalRender(env, auth, { id, renderId }) {
  const lesson = await ownLesson(env, auth, id);
  if (lesson instanceof Response) return lesson;
  if (!env.UPLOADS) return json({ message: "File storage is not configured." }, 500);
  const folder = renderFolder(id, renderId);
  const cuesObject = await env.UPLOADS.get(`${folder.key}/cues.json`);
  if (!cuesObject) return json({ message: "Upload cues.json first." }, 400);
  let cues;
  try {
    cues = JSON.parse(await cuesObject.text());
  } catch {
    return json({ message: "cues.json is not valid." }, 400);
  }
  if (cues?.lessonId !== id) return json({ message: "These cues are for another lesson." }, 400);
  // The video the cues point at must be there before anyone plays it.
  for (const url of [cues.video, cues.videoAlpha].filter(Boolean)) {
    const here = String(url).startsWith(`${folder.url}/`);
    const found = here ? await env.UPLOADS.get(String(url).slice(1)) : null;
    if (!found) return json({ message: `Upload ${String(url).split("/").pop()} first.` }, 400);
  }
  const now = new Date().toISOString();
  await publishRender(env, id, {
    renderId,
    scriptHash: await scriptHash(lesson.script),
    mediaUrl: folder.url,
    startedAt: now,
    at: now,
  });
  await cleanLessonRenders(env, id).catch((error) =>
    console.error(JSON.stringify({ message: "autoclass_clean_failed", lessonId: id, error: String(error?.message || error) })));
  return json({ ok: true, playUrl: `/autoclass.html?lesson=${encodeURIComponent(id)}` });
}

// One shared folder for every lesson's quiz media; a new upload under the same name replaces the old.
async function saveMedia(request, env, name) {
  if (!MEDIA_NAME.test(name)) return json({ message: "Name it like kai-tak.jpg: lowercase letters, digits, - or _, then .jpg .jpeg .png .webp .mp3 .m4a or .mp4." }, 400);
  if (!env.UPLOADS) return json({ message: "File storage is not configured." }, 500);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return json({ message: "The file is empty." }, 400);
  if (bytes.byteLength > MAX_MEDIA_BYTES) return json({ message: "At most 20 MB." }, 413);
  const url = `${MEDIA_FOLDER}/${name}`;
  await storeUpload(env, url, bytes);
  return json({ ok: true, url, size: bytes.byteLength }, 201);
}

async function readLessonApi(env, auth, id) {
  const lesson = await ownLesson(env, auth, id);
  if (lesson instanceof Response) return lesson;
  return json({ ok: true, lesson: await lessonView(env, lesson) });
}

async function startRender(env, auth, id, origin) {
  if (!env.AUTOCLASS_VIDEO) return json({ message: "The lesson renderer is not configured." }, 500);
  const lesson = await ownLesson(env, auth, id);
  if (lesson instanceof Response) return lesson;
  const checked = validateLessonScript(lesson.script);
  if (!checked.ok) return json({ message: "The saved script has problems.", errors: checked.errors }, 400);
  const hash = await scriptHash(lesson.script);

  // One render per lesson at a time: a second request gets the one already running.
  if (lesson.render?.jobId) {
    const running = await jobState(env, lesson.render.jobId).catch(() => null);
    if (running && !TERMINAL.has(running.status)) {
      return json({ ok: true, jobId: lesson.render.jobId, status: running.status, alreadyRunning: true, stale: lesson.render.scriptHash !== hash }, 202);
    }
  }

  const jobId = crypto.randomUUID().replace(/-/g, "");
  const mediaUrl = renderFolder(id, jobId).url;
  try {
    const res = await env.AUTOCLASS_VIDEO.getByName(jobId).fetch("http://autoclass/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId,
        meta: { lessonId: id, scriptHash: hash },
        lessonId: id,
        script: checked.script,
        lines: spokenLines(checked.script),
        mediaUrl,
        routerBase: routerBase(env),
        // The renderer reads lines Tommy has said before from here (the public /uploads route).
        voiceCacheUrl: `${origin}/${VOICE_CACHE_PREFIX}`,
        // Quiz pictures and sound clips (PUT /api/autoclass/media/:name), read the same way.
        mediaFilesUrl: `${origin}${MEDIA_FOLDER}`,
      }),
    });
    const job = await res.json();
    if (!res.ok) return json({ message: job?.error || "Could not start the lesson render." }, 502);
    lesson.render = { jobId, scriptHash: hash, startedAt: new Date().toISOString() };
    await writeLesson(env, lesson);
    return json({ ok: true, jobId, status: job.status }, 202);
  } catch (error) {
    console.error(JSON.stringify({ message: "autoclass_render_start_failed", lessonId: id, error: String(error?.message || error) }));
    return json({ message: "Could not start the lesson render." }, 502);
  }
}

async function jobStatus(env, auth, jobId) {
  if (!JOB_ID.test(jobId)) return json({ message: "Job id is required." }, 400);
  if (!env.AUTOCLASS_VIDEO) return json({ message: "The lesson renderer is not configured." }, 500);
  let job;
  try {
    job = await jobState(env, jobId);
  } catch (error) {
    console.error(JSON.stringify({ message: "autoclass_status_failed", jobId, error: String(error?.message || error) }));
    return json({ message: "Could not fetch the render status." }, 502);
  }
  if (job.status === "missing") return json({ message: "Render job not found." }, 404);
  const lesson = job.lessonId ? await readLesson(env, job.lessonId) : null;
  if (!lesson || !sameId(lesson.teacherId, auth.teacherId)) return json({ message: "Render job not found." }, 404);
  return json({ ok: true, ...publicJob(job) });
}

async function publishedCues(env, id) {
  const lesson = await readLesson(env, id);
  const renderId = lesson?.published?.renderId;
  if (!renderId) return json({ message: `Lesson "${id}" has not been rendered yet.` }, 404);
  const object = await env.UPLOADS?.get(`${renderFolder(id, renderId).key}/cues.json`);
  if (!object) return json({ message: `Lesson "${id}" has no cues.` }, 404);
  return new Response(object.body, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function ownLesson(env, auth, id) {
  const lesson = await readLesson(env, id);
  if (!lesson || !sameId(lesson.teacherId, auth.teacherId)) return json({ message: "Lesson not found." }, 404);
  return lesson;
}

async function lessonView(env, lesson) {
  let render = lesson.render || null;
  if (render?.jobId && env.AUTOCLASS_VIDEO) {
    const job = await jobState(env, render.jobId).catch(() => null);
    if (job && job.status !== "missing") render = { ...render, ...publicJob(job) };
  }
  const hash = await scriptHash(lesson.script);
  return {
    id: lesson.id,
    title: lesson.script?.title || "",
    script: lesson.script,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
    render,
    published: lesson.published ? { ...lesson.published, current: lesson.published.scriptHash === hash } : null,
    playUrl: lesson.published ? `/autoclass.html?lesson=${encodeURIComponent(lesson.id)}` : null,
  };
}

async function jobState(env, jobId) {
  const res = await env.AUTOCLASS_VIDEO.getByName(jobId).fetch("http://autoclass/status");
  return res.json();
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    lessonId: job.lessonId,
    status: job.status,
    logs: job.logs,
    error: job.error,
    segmentCount: job.segmentCount,
    segmentsDone: job.segmentsDone,
    videoUrl: job.videoUrl || null,
    cuesUrl: job.cuesUrl || null,
  };
}

// Where the renderer can reach this Worker's /uploads (for the voice cache). PUBLIC_BASE_URL wins,
// as for join links: `wrangler dev` reports the production host in request URLs.
function publicOrigin(env, url) {
  const configured = String(env?.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  return /^https?:\/\/[^/]+$/.test(configured) ? configured : url.origin;
}

function routerBase(env) {
  const cms = String(env?.CMS_API_BASE || "https://newcms.lango.ai").replace(/\/$/, "");
  return `${cms}/api/router`;
}
