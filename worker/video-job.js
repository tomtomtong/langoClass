// The life of one Uncle Tommy lecture video job, run by VideoContainer
// (video-container.js), which passes itself in as `box`: its Durable Object
// storage, its render container (containerFetch, stop), its alarms
// (schedule) and env.UPLOADS. Kept apart from the class so it can be tested
// without the containers runtime.

export const POLL_SECONDS = 15;
const MAX_JOB_MS = 60 * 60 * 1000;
const MAX_SAVE_ATTEMPTS = 4;
const STALE_POLL_MS = 2 * 60 * 1000;
export const QUEUE_RETRY_SECONDS = 20;
const MAX_QUEUE_MS = 30 * 60 * 1000;
export const TERMINAL = new Set(["completed", "failed"]);

// The poll chain lives in scheduled alarms; if a poll died or a code update
// reset the object mid-job, schedule the next step again on start-up.
export async function resumeStalled(box) {
  const job = await box.ctx.storage.get("job");
  if (!job || TERMINAL.has(job.status) || Date.now() - (job.lastPolledAt || 0) < STALE_POLL_MS) return;
  console.log(JSON.stringify({ message: "video_poll_resumed", jobId: job.jobId, status: job.status }));
  if (job.status === "queued") await box.schedule(QUEUE_RETRY_SECONDS, "tryStart");
  else await box.schedule(POLL_SECONDS, "poll");
}

export async function startJob(box, { jobId, text, routerBase }) {
  const existing = await box.ctx.storage.get("job");
  if (existing) return Response.json(existing, { status: 202 });
  const now = Date.now();
  const job = { jobId, status: "queued", logs: ["Queued."], error: null, videoUrl: null, segmentCount: 0, segmentsDone: 0, queuedAt: now, startedAt: now, lastPolledAt: now };
  await box.ctx.storage.put("request", { text, routerBase });
  await box.ctx.storage.put("job", job);
  await tryStart(box);
  return Response.json(await box.ctx.storage.get("job"), { status: 202 });
}

// Starting fails while every renderer is busy (max_instances in wrangler.jsonc);
// the job then waits here and tries again until one is free.
export async function tryStart(box) {
  const job = await box.ctx.storage.get("job");
  if (!job || job.status !== "queued") return;
  const request = await box.ctx.storage.get("request");
  job.lastPolledAt = Date.now();
  try {
    const res = await box.containerFetch("http://container/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.jobId, ...request }),
    });
    if (res.status >= 500) throw new Error(`Video container returned ${res.status}.`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      await fail(box, job, data.message || `Video container returned ${res.status}.`);
      return;
    }
    Object.assign(job, { status: "planning", startedAt: Date.now() });
    await box.ctx.storage.put("job", job);
    await box.ctx.storage.delete("request");
    await box.schedule(POLL_SECONDS, "poll");
  } catch (error) {
    console.warn(JSON.stringify({ message: "video_start_waiting", jobId: job.jobId, error: String(error?.message || error) }));
    if (Date.now() - job.queuedAt > MAX_QUEUE_MS) {
      await fail(box, job, "All video renderers stayed busy. Try again in a few minutes.");
      return;
    }
    if (!job.waiting) {
      job.waiting = true;
      job.logs = [...job.logs, "Waiting for a free video renderer…"];
    }
    await box.ctx.storage.put("job", job);
    await box.schedule(QUEUE_RETRY_SECONDS, "tryStart");
  }
}

export async function poll(box) {
  const job = await box.ctx.storage.get("job");
  if (!job || TERMINAL.has(job.status) || job.status === "queued") return;
  // A finished video is still on the container, so saving is not held to the render limit.
  if (job.status !== "saving" && Date.now() - job.startedAt > MAX_JOB_MS) {
    await fail(box, job, "Video generation took too long.");
    return;
  }
  job.lastPolledAt = Date.now();
  await box.ctx.storage.put("job", job);
  try {
    const res = await box.containerFetch(`http://container/jobs/${job.jobId}`);
    if (res.status === 404) {
      await fail(box, job, "The video renderer restarted before the video was finished. Try again.");
      return;
    }
    const state = await res.json();
    Object.assign(job, {
      status: state.status === "completed" ? "saving" : state.status,
      logs: Array.isArray(state.logs) ? state.logs : job.logs,
      segmentCount: state.segmentCount || 0,
      segmentsDone: state.segmentsDone || 0,
    });
    if (state.status === "failed") {
      await fail(box, job, state.error || "Video generation failed.");
      return;
    }
    await box.ctx.storage.put("job", job);
    if (state.status === "completed") {
      await saveVideo(box, job);
      return;
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "video_poll_failed", jobId: job.jobId, status: job.status, error: String(error?.message || error) }));
    if (job.status === "saving") {
      job.saveAttempts = (job.saveAttempts || 0) + 1;
      if (job.saveAttempts >= MAX_SAVE_ATTEMPTS) {
        await fail(box, job, "The video was made but could not be saved. Try again.");
        return;
      }
      await box.ctx.storage.put("job", job);
    }
  }
  await box.schedule(POLL_SECONDS, "poll");
}

async function saveVideo(box, job) {
  const res = await box.containerFetch(`http://container/jobs/${job.jobId}/video`);
  if (!res.ok || !res.body) throw new Error(`Could not read the finished video (${res.status}).`);
  const size = Number(res.headers.get("content-length") || 0);
  if (!size) throw new Error("The finished video has no length.");
  // R2 needs the length up front for a streamed body. The container's body
  // cannot pipeTo() a FixedLengthStream, so copy it chunk by chunk.
  const { readable, writable } = new FixedLengthStream(size);
  const copying = copyStream(res.body, writable);
  const key = `lectures/tommy-${job.jobId}.mp4`;
  console.log(JSON.stringify({ message: "video_save_started", jobId: job.jobId, bytes: size }));
  await Promise.all([box.env.UPLOADS.put(key, readable, { httpMetadata: { contentType: "video/mp4" } }), copying]);
  console.log(JSON.stringify({ message: "video_saved", jobId: job.jobId, key, seconds: Math.round((Date.now() - job.startedAt) / 1000) }));
  Object.assign(job, { status: "completed", videoUrl: `/uploads/${key}` });
  job.logs = [...job.logs, "Saved."];
  await box.ctx.storage.put("job", job);
  await box.stop();
}

async function fail(box, job, message) {
  Object.assign(job, { status: "failed", error: message });
  job.logs = [...(job.logs || []), `Failed: ${message}`];
  await box.ctx.storage.put("job", job);
  await box.stop().catch(() => {});
  return job;
}

async function copyStream(from, to) {
  const reader = from.getReader();
  const writer = to.getWriter();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }
}
