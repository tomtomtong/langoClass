// One autoclass lesson render in the video container (server.mjs routes /autoclass/jobs here):
// voice every line of the lesson script in Uncle Tommy's voice, write the HyperFrames project
// (lesson.mjs), render it, and list the files the Worker copies into R2
// (worker/autoclass-job.js) under the job's mediaUrl.
//
// Voice cache: lines Tommy has said before (same text, voice, language and speed) are read from
// the R2 cache at `voiceCacheUrl` instead of being voiced again. Lines voiced fresh go to out/_voice/
// and the Worker adds them to the cache, so a re-render after a small edit only voices what changed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { speak, voiceKey } from "../voice.mjs";
import { buildLesson } from "./lesson.mjs";

const VOICE_WORKERS = 3;
const MAX_CACHED_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
// The same as lib/autoclass-script.mjs (the image holds only video-container/, so it cannot import it).
const MEDIA_FOLDER = "/uploads/autoclass/_media";
const MEDIA_NAME = /^[a-z0-9][a-z0-9_-]{0,59}\.(?:jpg|jpeg|png|webp|mp3|m4a|mp4)$/;

// Every quiz picture, sound clip and reveal video a (checked) script uses, as names in MEDIA_FOLDER.
export function mediaFiles(script) {
  const urls = (script?.scenes || []).filter((s) => s?.kind === "quiz").flatMap((s) => [s.image, s.clip?.src, s.revealVideo?.src]).filter(Boolean);
  return [...new Set(urls.filter((u) => typeof u === "string" && u.startsWith(`${MEDIA_FOLDER}/`)).map((u) => u.slice(MEDIA_FOLDER.length + 1)))];
}
const TYPES = { mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", json: "application/json" };

function audioSeconds(file) {
  return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
}

// Checks a job request; returns an error message or "".
export function badAutoclassRequest(body) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(body?.jobId || ""))) return "jobId is required.";
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(String(body?.lessonId || ""))) return "lessonId is required.";
  if (!body?.script || typeof body.script !== "object" || body.script.id !== body.lessonId) return "A lesson script for lessonId is required.";
  if (!/^\/uploads\/autoclass\/[a-z0-9-]+\/[A-Za-z0-9_-]+$/.test(String(body?.mediaUrl || ""))) return "mediaUrl is required.";
  if (!/^https?:\/\//.test(String(body?.routerBase || ""))) return "routerBase is required.";
  if (body?.voiceCacheUrl != null && !/^https?:\/\/[^/]+\/uploads\/autoclass\/_voice$/.test(String(body.voiceCacheUrl))) return "voiceCacheUrl is not the voice cache.";
  if (body?.mediaFilesUrl != null && !/^https?:\/\/[^/]+\/uploads\/autoclass\/_media$/.test(String(body.mediaFilesUrl))) return "mediaFilesUrl is not the media folder.";
  if (mediaFiles(body.script).length && !body?.mediaFilesUrl) return "The lesson uses pictures or sound clips but mediaFilesUrl is missing.";
  return "";
}

export async function runAutoclassJob(job, request, { workDir, log, render }) {
  const { lessonId, script, mediaUrl } = request;
  const routerBase = String(request.routerBase).replace(/\/$/, "");
  const dir = path.join(workDir, job.jobId);
  try {
    let phaseStart = Date.now();
    fs.mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    const voice = makeVoice({
      dir,
      language: script.voice?.language || "en-US",
      rate: script.voice?.speakingRate || 1,
      cacheUrl: request.voiceCacheUrl || "",
      speakLine: (text, language, rate) => speak(routerBase, text, language, rate),
      onDone: () => (job.segmentsDone += 1),
      stats: (job.voice = { cached: 0, voiced: 0 }),
    });

    // Voice every line first, a few at a time (the Worker sends the list); the builder then only
    // looks them up, and voices any line the list missed on the way.
    job.status = "voicing";
    const lines = [...new Set((Array.isArray(request.lines) ? request.lines : []).filter((t) => typeof t === "string" && t.trim()))];
    job.segmentCount = lines.length;
    job.segmentsDone = 0;
    log(job, `Recording Uncle Tommy's voice (${lines.length} lines; cache ${request.voiceCacheUrl || "off"})…`);
    let next = 0;
    const worker = async () => {
      while (next < lines.length) await voice(lines[next++]);
    };
    await Promise.all(Array.from({ length: VOICE_WORKERS }, worker));
    log(job, `Voice took ${Math.round((Date.now() - phaseStart) / 1000)} s (${job.voice.cached} from the cache, ${job.voice.voiced} new${job.voice.problem ? `; ${job.voice.problem}` : ""}).`);

    const names = mediaFiles(script);
    if (names.length) log(job, `Fetching ${names.length} picture and sound files…`);
    const media = await fetchMedia({ dir, baseUrl: request.mediaFilesUrl, names });
    const built = await buildLesson(dir, script, { voice, mediaUrl, media });
    log(job, `Lesson is ${Math.round(built.total)} s long with ${built.cues.cues.length} pauses. Rendering…`);
    job.status = "rendering";
    job.segmentCount = 0;
    job.segmentsDone = 0;
    phaseStart = Date.now();
    await render(job, dir, path.join(dir, "out", `${lessonId}.mp4`));
    log(job, `Render took ${Math.round((Date.now() - phaseStart) / 1000)} s.`);
    await renderSeeThrough({ job, dir, lessonId, mediaUrl, render, log });

    job.files = listFiles(path.join(dir, "out"));
    job.output = path.join(dir, "out");
    job.status = "completed";
    log(job, `Done in ${Math.round((Date.now() - job.startedAt) / 1000)} s (${job.files.length} files).`);
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    log(job, `Failed: ${job.error}`);
  }
}

// A second render with no background, so the page can put its own colour or blurred photo behind
// the lesson (public/autoclass.js). It plays in Chrome, Edge and Firefox; Safari keeps playing the
// normal video. If this render fails the lesson is unaffected: cues.json just has no videoAlpha.
export async function renderSeeThrough({ job, dir, lessonId, mediaUrl, render, log }) {
  const out = path.join(dir, "out", `${lessonId}-alpha.webm`);
  const index = path.join(dir, "index.html");
  try {
    const started = Date.now();
    log(job, "Rendering the see-through version for the background picker…");
    job.segmentCount = 0;
    job.segmentsDone = 0;
    const html = fs.readFileSync(index, "utf8");
    if (!html.includes("</head>")) throw new Error("the lesson page has no head to change");
    fs.writeFileSync(index, html.replace("</head>", "<style>html, body, #root { background: transparent !important; } #ground { display: none !important; }</style></head>"));
    await render(job, dir, out);
    const cuesFile = path.join(dir, "out", "cues.json");
    const cues = JSON.parse(fs.readFileSync(cuesFile, "utf8"));
    cues.videoAlpha = `${mediaUrl}/${lessonId}-alpha.webm`;
    fs.writeFileSync(cuesFile, `${JSON.stringify(cues, null, 2)}\n`);
    log(job, `See-through render took ${Math.round((Date.now() - started) / 1000)} s.`);
  } catch (error) {
    fs.rmSync(out, { force: true });
    log(job, `The see-through version failed (${error instanceof Error ? error.message : error}); the lesson keeps its own background.`);
  }
}

// voice(text) → Promise<{ file, seconds }>, each distinct text once: from the cache when it has it,
// otherwise from TTS, and then also copied to out/_voice/<key>.mp3 for the Worker to cache.
export function makeVoice({ dir, language, rate, cacheUrl, speakLine, onDone = () => {}, stats = { cached: 0, voiced: 0 }, fetchImpl = fetch, seconds = audioSeconds }) {
  const voiced = new Map();
  return (text) => {
    if (!voiced.has(text)) {
      voiced.set(text, (async () => {
        const key = voiceKey(text, language, rate);
        const file = path.join("assets", "voice", `${key}.mp3`);
        let bytes = cacheUrl ? await fromCache(fetchImpl, `${cacheUrl}/${key}.mp3`, stats) : null;
        if (bytes) stats.cached += 1;
        else {
          bytes = await speakLine(text, language, rate);
          stats.voiced += 1;
          fs.mkdirSync(path.join(dir, "out", "_voice"), { recursive: true });
          fs.writeFileSync(path.join(dir, "out", "_voice", `${key}.mp3`), bytes);
        }
        fs.writeFileSync(path.join(dir, file), bytes);
        onDone();
        return { file, seconds: seconds(path.join(dir, file)) };
      })());
    }
    return voiced.get(text);
  };
}

// Downloads each quiz picture and sound clip into assets/media/ and returns media(url) → the file,
// relative to dir, for buildLesson. A missing file fails the render with its name.
export async function fetchMedia({ dir, baseUrl, names, fetchImpl = fetch }) {
  const files = new Map();
  if (names.length) fs.mkdirSync(path.join(dir, "assets", "media"), { recursive: true });
  for (const name of names) {
    if (!MEDIA_NAME.test(name)) throw new Error(`Not a media file name: ${name}`);
    const res = await fetchImpl(`${baseUrl}/${name}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Could not fetch ${MEDIA_FOLDER}/${name} (${res.status}). Upload it first.`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error(`${MEDIA_FOLDER}/${name} is empty or over 20 MB.`);
    const file = path.join("assets", "media", name);
    fs.writeFileSync(path.join(dir, file), bytes);
    files.set(`${MEDIA_FOLDER}/${name}`, file.split(path.sep).join("/"));
  }
  return (url) => {
    if (!files.has(url)) throw new Error(`${url} was not fetched.`);
    return files.get(url);
  };
}

// A cached line, or null for a miss or any trouble reading it (the line is then voiced again).
async function fromCache(fetchImpl, url, stats) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      if (res.status !== 404) stats.problem ??= `cache answered ${res.status}`;
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_CACHED_BYTES ? bytes : null;
  } catch (error) {
    stats.problem ??= `cache unreachable: ${error?.cause?.code || error?.message || error}`;
    return null;
  }
}

// [{ name, size, type }] for every file under out/, cues.json last (the Worker saves in this order,
// so the cues only point at media that is already there).
export function listFiles(root) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
  return walk(root)
    .map((full) => {
      const name = path.relative(root, full).split(path.sep).join("/");
      return { name, size: fs.statSync(full).size, type: TYPES[name.split(".").pop().toLowerCase()] || "application/octet-stream" };
    })
    .sort((a, b) => (a.name === "cues.json") - (b.name === "cues.json") || a.name.localeCompare(b.name));
}

// The path of one finished file, or null if the name is not one the job listed.
export function jobFile(job, name) {
  if (job.status !== "completed" || !job.output || !Array.isArray(job.files)) return null;
  const file = job.files.find((f) => f.name === name);
  return file ? { ...file, path: path.join(job.output, ...file.name.split("/")) } : null;
}
