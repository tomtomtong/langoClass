#!/usr/bin/env node
// Renders an autoclass lesson on this computer and publishes it, much faster than the container
// (a Mac with a real GPU finishes in minutes; the container takes 30+ min and can be restarted
// mid-render). It runs the same code the container runs (video-container/autoclass/job.mjs), then
// uploads the files to the Worker (PUT .../local-render/... in worker/autoclass-api.js) and
// publishes them, so the class plays the new video at once.
//
//   npm install --no-save hyperframes@0.9.40      (once; it brings its own headless Chrome)
//   LANGO_TOKEN=<your login token> LANGO_TEACHER_ID=<your teacher id> \
//     node scripts/autoclass-render-local.mjs hk-nostalgia
//
// A --dry run needs neither: it renders the script in autoclass-video/lessons/.
// The token and teacher id are the ones the host page keeps in localStorage `lango_host_prefs`
// (token, user.id). Nothing is printed or stored. Options:
//   --origin https://class.lango.ai   the Worker (default)
//   --no-alpha                        skip the see-through version (no background picker)
//   --workers N                       parallel Chrome processes (default: CPU count, at most 6)
//   --dry                             render only, upload nothing
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { spokenLines, validateLessonScript, MEDIA_FOLDER } from "../lib/autoclass-script.mjs";
import { badAutoclassRequest, listFiles, runAutoclassJob } from "../video-container/autoclass/job.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const lessonId = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--origin" && args[i - 1] !== "--workers");
const origin = option("--origin", "https://class.lango.ai").replace(/\/$/, "");
const workers = option("--workers", String(Math.max(2, Math.min(6, os.cpus().length))));
const dry = flag("--dry");
const noAlpha = flag("--no-alpha");
const token = process.env.LANGO_TOKEN || "";
const teacherId = process.env.LANGO_TEACHER_ID || "";
const routerBase = (process.env.LANGO_ROUTER_BASE || "https://newcms.lango.ai/api/router").replace(/\/$/, "");
const hfBin = process.env.HYPERFRAMES_BIN || path.join(ROOT, "node_modules", ".bin", "hyperframes");

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!lessonId) die("Usage: node scripts/autoclass-render-local.mjs <lesson-id> [--origin URL] [--no-alpha] [--workers N] [--dry]");
if (!existsSync(hfBin)) die(`HyperFrames is not installed here (${hfBin}).\nRun once: npm install --no-save hyperframes@0.9.40`);
if (!dry && (!token || !teacherId)) die("Set LANGO_TOKEN and LANGO_TEACHER_ID (see the top of this file), or use --dry to render without uploading.");

const headers = () => ({ authorization: `Bearer ${token}`, "x-teacher-id": String(teacherId) });
const stamp = () => new Date().toLocaleTimeString();
const log = (_job, message) => console.log(`[${stamp()}] ${message}`);

// One HyperFrames render, as the container runs it (video-container/server.mjs render()).
function render(_job, dir, out) {
  const webm = out.endsWith(".webm");
  if (webm && noAlpha) return Promise.reject(new Error("skipped (--no-alpha)"));
  const extra = webm ? ["--format", "webm"] : ["--crf", "28"];
  const hfArgs = ["render", dir, "-o", out, "--fps", "24", "--quality", "standard", "--workers", workers, ...extra];
  return new Promise((resolve, reject) => {
    const child = spawn(hfBin, hfArgs, { cwd: dir, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    let lastPct = -1;
    const onData = (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-3000);
      for (const line of text.split("\n")) {
        const match = line.match(/@hf-progress (\{.*\})/);
        if (!match) continue;
        try {
          const pct = JSON.parse(match[1]).pct ?? 0;
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            process.stdout.write(`\r  ${path.basename(out)} ${pct}%   `);
          }
        } catch {
          /* progress line only */
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => {
      process.stdout.write("\n");
      if (code === 0) resolve();
      else reject(new Error(`HyperFrames exited with ${code}: ${tail.split("\n").filter(Boolean).slice(-3).join(" | ")}`));
    });
  });
}

async function getScript() {
  // A dry run needs no login: it renders the script in this repository (autoclass-video/lessons/).
  if (dry && !token) {
    const file = path.join(ROOT, "autoclass-video", "lessons", `${lessonId}.json`);
    if (!existsSync(file)) die(`No ${file}. Set LANGO_TOKEN and LANGO_TEACHER_ID to read the saved lesson instead.`);
    return JSON.parse(readFileSync(file, "utf8"));
  }
  const res = await fetch(`${origin}/api/autoclass/lessons/${lessonId}`, { headers: dry && !token ? {} : headers() });
  if (!res.ok) die(`Could not read lesson "${lessonId}" (${res.status}). Save it first, and check the token and teacher id.`);
  const body = await res.json();
  return body.lesson?.script;
}

async function upload(renderId, files, dir) {
  for (const file of files) {
    const url = `${origin}/api/autoclass/lessons/${lessonId}/local-render/${renderId}/files/${file.name.split("/").map(encodeURIComponent).join("/")}`;
    const full = path.join(dir, "out", ...file.name.split("/"));
    for (let attempt = 1; ; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: { ...headers(), "content-length": String(file.size) },
          body: Readable.toWeb(createReadStream(full)),
          duplex: "half",
        });
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
        break;
      } catch (error) {
        if (attempt >= 3) die(`Could not upload ${file.name}: ${error.message}`);
        console.log(`  retrying ${file.name} (${error.message})`);
      }
    }
    console.log(`  uploaded ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`);
  }
}

const saved = await getScript();
const checked = validateLessonScript(saved);
if (!checked.ok) die(`The saved script has problems: ${JSON.stringify(checked.errors).slice(0, 300)}`);
const script = checked.script;

const renderId = crypto.randomUUID().replace(/-/g, "");
const request = {
  jobId: renderId,
  lessonId,
  script,
  lines: spokenLines(script),
  mediaUrl: `/uploads/autoclass/${lessonId}/${renderId}`,
  routerBase,
  voiceCacheUrl: `${origin}/uploads/autoclass/_voice`,
  mediaFilesUrl: `${origin}${MEDIA_FOLDER}`,
};
const bad = badAutoclassRequest(request);
if (bad) die(bad);

const workDir = path.join(os.tmpdir(), "autoclass-local");
mkdirSync(workDir, { recursive: true });
const job = { jobId: renderId, logs: [], startedAt: Date.now() };
const lastLog = job.logs;
console.log(`Rendering "${lessonId}" here (${workers} workers). Render id ${renderId}`);
await runAutoclassJob(job, request, { workDir, log: (j, m) => log(j, m), render });
if (job.status !== "completed") die(`The render failed: ${job.error || "unknown error"}`);
void lastLog;

const dir = path.join(workDir, renderId);
const files = job.files;
const names = files.map((f) => f.name);
if (!names.includes("cues.json") || !names.some((n) => n === `${lessonId}.mp4`)) die("The render is missing its video or cues.");
console.log(`Rendered ${files.length} files${names.some((n) => n.endsWith("-alpha.webm")) ? " (with the see-through version)" : " (no see-through version)"}.`);

if (dry) {
  console.log(`--dry: nothing uploaded. Files are in ${path.join(dir, "out")}`);
  process.exit(0);
}

console.log("Uploading…");
await upload(renderId, listFiles(path.join(dir, "out")), dir);
const res = await fetch(`${origin}/api/autoclass/lessons/${lessonId}/local-render/${renderId}/publish`, { method: "POST", headers: headers() });
const body = await res.json().catch(() => ({}));
if (!res.ok) die(`Publish failed (${res.status}): ${body.message || ""}`);
rmSync(dir, { recursive: true, force: true });
console.log(`\nDone. The class now plays it: ${origin}${body.playUrl || `/autoclass.html?lesson=${lessonId}`}`);
