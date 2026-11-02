// Uncle Tommy lecture video container. One job per container instance:
//   POST /jobs { jobId, text, routerBase }  start making the video
//   GET  /jobs/:id                           status, logs, progress
//   GET  /jobs/:id/video                     the finished MP4
// Steps: lesson plan (router LLM) -> Tommy's voice per slide (router TTS)
// -> HyperFrames project -> render.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planLecture } from "./plan.mjs";
import { speak, speechLanguage } from "./voice.mjs";
import { lectureScenes, writeProject } from "./build.mjs";

const PORT = Number(process.env.PORT || 8080);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = process.env.VIDEO_WORK_DIR || path.join(os.tmpdir(), "lecture-jobs");
const HF_BIN = process.env.HYPERFRAMES_BIN || "hyperframes";
const MAX_LOGS = 60;
const jobs = new Map();

function newJob(jobId) {
  const job = { jobId, status: "queued", logs: [], error: null, segmentCount: 0, segmentsDone: 0, output: null, startedAt: Date.now() };
  jobs.set(jobId, job);
  return job;
}

function log(job, line) {
  job.logs.push(line);
  if (job.logs.length > MAX_LOGS) job.logs.splice(0, job.logs.length - MAX_LOGS);
  console.log(`[${job.jobId}] ${line}`);
}

function setLastLog(job, line) {
  if (job.logs.length && job.logs[job.logs.length - 1].startsWith("Rendering")) job.logs[job.logs.length - 1] = line;
  else log(job, line);
}

function audioSeconds(file) {
  return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
}

async function runJob(job, text, routerBase) {
  const dir = path.join(WORK, job.jobId);
  try {
    job.status = "planning";
    const plan = await planLecture(routerBase, text, (line) => log(job, line));
    fs.mkdirSync(path.join(dir, "assets", "voice"), { recursive: true });
    for (const file of ["tommy-talking.webm", "lango-logo.png"]) {
      fs.copyFileSync(path.join(HERE, "assets", file), path.join(dir, "assets", file));
    }

    job.status = "voicing";
    const scenes = lectureScenes(plan);
    const language = speechLanguage(text);
    job.segmentCount = scenes.length;
    job.segmentsDone = 0;
    log(job, `Recording Uncle Tommy's voice (${scenes.length} parts)…`);
    const voices = {};
    let next = 0;
    const worker = async () => {
      while (next < scenes.length) {
        const scene = scenes[next++];
        const file = path.join(dir, "assets", "voice", `${scene.id}.mp3`);
        fs.writeFileSync(file, await speak(routerBase, scene.narration, language));
        voices[scene.id] = audioSeconds(file);
        job.segmentsDone++;
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));

    const built = writeProject(dir, plan, voices);
    log(job, `Video is ${Math.round(built.total)} s long. Rendering…`);
    job.status = "rendering";
    job.segmentCount = 0;
    job.segmentsDone = 0;
    const output = path.join(dir, "lecture.mp4");
    await render(job, dir, output);
    job.output = output;
    job.status = "completed";
    log(job, `Done in ${Math.round((Date.now() - job.startedAt) / 1000)} s.`);
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    log(job, `Failed: ${job.error}`);
  }
}

function render(job, dir, output) {
  return new Promise((resolve, reject) => {
    const args = ["render", dir, "-o", output, "--quality", "standard", "--workers", process.env.HF_WORKERS || "auto"];
    const child = spawn(HF_BIN, args, { cwd: dir, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
    let tail = "";
    const onData = (chunk) => {
      const textChunk = chunk.toString();
      tail = (tail + textChunk).slice(-4000);
      for (const line of textChunk.split("\n")) {
        const match = line.match(/@hf-progress (\{.*\})/);
        if (!match) continue;
        try {
          const p = JSON.parse(match[1]);
          if (p.total) {
            job.segmentCount = p.total;
            job.segmentsDone = p.done;
          }
          setLastLog(job, `Rendering… ${p.pct ?? 0}%`);
        } catch {}
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(output)) return resolve();
      reject(new Error(`Render failed (exit ${code}): ${tail.split("\n").filter(Boolean).slice(-5).join(" | ")}`));
    });
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function publicJob(job) {
  const { output, startedAt, ...rest } = job;
  return { ...rest, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://container");
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/jobs") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const jobId = String(body.jobId || "").trim();
      const text = String(body.text || "").trim();
      const routerBase = String(body.routerBase || "").replace(/\/$/, "");
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(jobId) || !text || !/^https?:\/\//.test(routerBase)) {
        return sendJson(res, 400, { message: "jobId, text and routerBase are required." });
      }
      const existing = jobs.get(jobId);
      if (existing) return sendJson(res, 202, publicJob(existing));
      const job = newJob(jobId);
      log(job, "Queued.");
      runJob(job, text, routerBase);
      return sendJson(res, 202, publicJob(job));
    }
    const match = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)(\/video)?$/);
    if (req.method === "GET" && match) {
      const job = jobs.get(match[1]);
      if (!job) return sendJson(res, 404, { message: "Job not found." });
      if (!match[2]) return sendJson(res, 200, publicJob(job));
      if (job.status !== "completed" || !job.output) return sendJson(res, 409, { message: "Video is not ready." });
      const size = fs.statSync(job.output).size;
      res.writeHead(200, { "content-type": "video/mp4", "content-length": size });
      return fs.createReadStream(job.output).pipe(res);
    }
    sendJson(res, 404, { message: "Not found." });
  } catch (error) {
    sendJson(res, 500, { message: error instanceof Error ? error.message : "Server error." });
  }
});

server.listen(PORT, () => console.log(`lecture video container on ${PORT}`));
