// One autoclass lesson render in the video container (server.mjs routes /autoclass/jobs here):
// voice every line of the lesson script in Uncle Tommy's voice, write the HyperFrames project
// (lesson.mjs), render it, and list the files the Worker copies into R2
// (worker/autoclass-job.js) under the job's mediaUrl.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { speak } from "../voice.mjs";
import { buildLesson } from "./lesson.mjs";

const VOICE_WORKERS = 3;
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
  return "";
}

export async function runAutoclassJob(job, request, { workDir, log, render }) {
  const { lessonId, script, mediaUrl } = request;
  const routerBase = String(request.routerBase).replace(/\/$/, "");
  const dir = path.join(workDir, job.jobId);
  try {
    let phaseStart = Date.now();
    fs.mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    const language = script.voice?.language || "en-US";
    const rate = script.voice?.speakingRate || 1;
    const voiced = new Map(); // text → Promise<{ file, seconds }>
    const voice = (text) => {
      if (!voiced.has(text)) {
        voiced.set(text, (async () => {
          const key = createHash("sha1").update(`${language}|${rate}|${text}`).digest("hex").slice(0, 12);
          const file = path.join("assets", "voice", `${key}.mp3`);
          fs.writeFileSync(path.join(dir, file), await speak(routerBase, text, language, rate));
          job.segmentsDone += 1;
          return { file, seconds: audioSeconds(path.join(dir, file)) };
        })());
      }
      return voiced.get(text);
    };

    // Voice every line first, a few at a time (the Worker sends the list); the builder then only
    // looks them up, and voices any line the list missed on the way.
    job.status = "voicing";
    const lines = [...new Set((Array.isArray(request.lines) ? request.lines : []).filter((t) => typeof t === "string" && t.trim()))];
    job.segmentCount = lines.length;
    job.segmentsDone = 0;
    log(job, `Recording Uncle Tommy's voice (${lines.length} lines)…`);
    let next = 0;
    const worker = async () => {
      while (next < lines.length) await voice(lines[next++]);
    };
    await Promise.all(Array.from({ length: VOICE_WORKERS }, worker));
    log(job, `Voice took ${Math.round((Date.now() - phaseStart) / 1000)} s.`);

    const built = await buildLesson(dir, script, { voice, mediaUrl });
    log(job, `Lesson is ${Math.round(built.total)} s long with ${built.cues.cues.length} pauses. Rendering…`);
    job.status = "rendering";
    job.segmentCount = 0;
    job.segmentsDone = 0;
    phaseStart = Date.now();
    await render(job, dir, path.join(dir, "out", `${lessonId}.mp4`));
    log(job, `Render took ${Math.round((Date.now() - phaseStart) / 1000)} s.`);

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
