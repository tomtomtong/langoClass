// The save step of an autoclass lesson render (autoclass-container.js). The queue, polling,
// stall-resume and time limits are the lecture video job's (video-job.js); only saving differs:
// a render is a folder (the video, every mp3 Tommy plays live, the talking loop and cues.json),
// copied file by file into R2 under uploads/autoclass/<lessonId>/<renderId>/, cues.json last.
// Progress is kept after each file, so a failed save picks up where it stopped. Lines voiced fresh
// for this render (_voice/<key>.mp3) go into the shared voice cache instead of the render folder.
import { fail, putStream } from "./video-job.js";
import { VOICE_CACHE_PREFIX, publishRender, renderFolder } from "./autoclass-lessons.js";

export const AUTOCLASS_PATHS = {
  start: "http://container/autoclass/jobs",
  status: (jobId) => `http://container/autoclass/jobs/${jobId}`,
  file: (jobId, name) => `http://container/autoclass/jobs/${jobId}/files/${name.split("/").map(encodeURIComponent).join("/")}`,
};

// Local work only: with AUTOCLASS_RENDERER_URL=http://localhost:<port> the job talks to the
// renderer run as a plain Node process (`node video-container/server.mjs`) instead of a container,
// for `wrangler dev --enable-containers=false`. Anything but a localhost URL is ignored.
export function devRenderer(env) {
  const raw = String(env?.AUTOCLASS_RENDERER_URL || "").trim().replace(/\/$/, "");
  return /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(raw) ? raw : "";
}

const SAFE_NAME = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:mp4|mp3|webm|json)$/;

export async function saveLessonRender(box, job, state) {
  const files = Array.isArray(state?.files) ? state.files : [];
  if (!files.some((f) => f?.name === "cues.json")) {
    await fail(box, job, "The render finished without a cues file.");
    return;
  }
  const bad = files.find((f) => !SAFE_NAME.test(String(f?.name || "")));
  if (bad) {
    await fail(box, job, `The render listed an unexpected file: ${String(bad?.name).slice(0, 80)}`);
    return;
  }
  // cues.json last: once it is in R2, everything it points at is too.
  const ordered = [...files.filter((f) => f.name !== "cues.json"), files.find((f) => f.name === "cues.json")];
  const folder = renderFolder(job.lessonId, job.jobId);
  job.segmentCount = ordered.length;
  job.savedFiles = job.savedFiles || 0;
  job.segmentsDone = job.savedFiles;
  if (!job.savedFiles) {
    job.logs = [...job.logs, `Saving ${ordered.length} files…`];
    console.log(JSON.stringify({ message: "autoclass_save_started", jobId: job.jobId, lessonId: job.lessonId, files: ordered.length }));
  }
  await box.ctx.storage.put("job", job);
  for (let i = job.savedFiles; i < ordered.length; i += 1) {
    const file = ordered[i];
    const res = await box.containerFetch(AUTOCLASS_PATHS.file(job.jobId, file.name));
    if (!res.ok) throw new Error(`Could not read ${file.name} from the renderer (${res.status}).`);
    const key = file.name.startsWith("_voice/") ? `${VOICE_CACHE_PREFIX}/${file.name.slice("_voice/".length)}` : `${folder.key}/${file.name}`;
    await putStream(box.env.UPLOADS, key, res, file.type || "application/octet-stream");
    job.savedFiles = i + 1;
    job.segmentsDone = job.savedFiles;
    await box.ctx.storage.put("job", job);
  }
  await publishRender(box.env, job.lessonId, {
    renderId: job.jobId,
    scriptHash: job.scriptHash || null,
    mediaUrl: folder.url,
    startedAt: job.queuedAt,
    at: new Date().toISOString(),
  });
  console.log(JSON.stringify({ message: "autoclass_saved", jobId: job.jobId, lessonId: job.lessonId, seconds: Math.round((Date.now() - job.startedAt) / 1000) }));
  Object.assign(job, { status: "completed", videoUrl: `${folder.url}/${job.lessonId}.mp4`, cuesUrl: `${folder.url}/cues.json` });
  job.logs = [...job.logs, "Saved."];
  await box.ctx.storage.put("job", job);
  await box.stop();
}
