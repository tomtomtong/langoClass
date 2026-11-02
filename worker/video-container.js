// One Uncle Tommy lecture video job per Durable Object (named by job id).
// The DO starts the render container (video-container/), polls it on a
// schedule so the job finishes even if the CMS tab closes, then copies the
// MP4 into R2 under lectures/ and stops the container.
import { Container } from "@cloudflare/containers";

const POLL_SECONDS = 15;
const MAX_JOB_MS = 60 * 60 * 1000;
const MAX_SAVE_ATTEMPTS = 4;
const STALE_POLL_MS = 2 * 60 * 1000;
const TERMINAL = new Set(["completed", "failed"]);

export class VideoContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";

  // The poll chain lives in scheduled alarms; if a poll died or a code update
  // reset this object mid-job, schedule the next poll again on start-up.
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const job = await ctx.storage.get("job");
      if (!job || TERMINAL.has(job.status) || Date.now() - (job.lastPolledAt || 0) < STALE_POLL_MS) return;
      console.log(JSON.stringify({ message: "video_poll_resumed", jobId: job.jobId, status: job.status }));
      await this.schedule(POLL_SECONDS, "poll");
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/start") return this.startJob(await request.json());
    if (request.method === "GET" && url.pathname === "/status") return Response.json((await this.ctx.storage.get("job")) || { status: "missing" });
    return new Response("Not found", { status: 404 });
  }

  async startJob({ jobId, text, routerBase }) {
    const existing = await this.ctx.storage.get("job");
    if (existing) return Response.json(existing, { status: 202 });
    const job = { jobId, status: "queued", logs: ["Queued."], error: null, videoUrl: null, segmentCount: 0, segmentsDone: 0, startedAt: Date.now() };
    await this.ctx.storage.put("job", job);
    const res = await this.containerFetch("http://container/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, text, routerBase }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return Response.json(await this.fail(job, data.message || `Video container returned ${res.status}.`), { status: 502 });
    }
    await this.schedule(POLL_SECONDS, "poll");
    return Response.json(job, { status: 202 });
  }

  async poll() {
    const job = await this.ctx.storage.get("job");
    if (!job || TERMINAL.has(job.status)) return;
    // A finished video is still on the container, so saving is not held to the render limit.
    if (job.status !== "saving" && Date.now() - job.startedAt > MAX_JOB_MS) {
      await this.fail(job, "Video generation took too long.");
      return;
    }
    job.lastPolledAt = Date.now();
    await this.ctx.storage.put("job", job);
    try {
      const res = await this.containerFetch(`http://container/jobs/${job.jobId}`);
      if (res.status === 404) {
        await this.fail(job, "The video renderer restarted before the video was finished. Try again.");
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
        await this.fail(job, state.error || "Video generation failed.");
        return;
      }
      await this.ctx.storage.put("job", job);
      if (state.status === "completed") {
        await this.saveVideo(job);
        return;
      }
    } catch (error) {
      console.error(JSON.stringify({ message: "video_poll_failed", jobId: job.jobId, status: job.status, error: String(error?.message || error) }));
      if (job.status === "saving") {
        job.saveAttempts = (job.saveAttempts || 0) + 1;
        if (job.saveAttempts >= MAX_SAVE_ATTEMPTS) {
          await this.fail(job, "The video was made but could not be saved. Try again.");
          return;
        }
        await this.ctx.storage.put("job", job);
      }
    }
    await this.schedule(POLL_SECONDS, "poll");
  }

  async saveVideo(job) {
    const res = await this.containerFetch(`http://container/jobs/${job.jobId}/video`);
    if (!res.ok || !res.body) throw new Error(`Could not read the finished video (${res.status}).`);
    const size = Number(res.headers.get("content-length") || 0);
    if (!size) throw new Error("The finished video has no length.");
    // R2 needs the length up front for a streamed body. The container's body
    // cannot pipeTo() a FixedLengthStream, so copy it chunk by chunk.
    const { readable, writable } = new FixedLengthStream(size);
    const copying = copyStream(res.body, writable);
    const key = `lectures/tommy-${job.jobId}.mp4`;
    console.log(JSON.stringify({ message: "video_save_started", jobId: job.jobId, bytes: size }));
    await Promise.all([this.env.UPLOADS.put(key, readable, { httpMetadata: { contentType: "video/mp4" } }), copying]);
    console.log(JSON.stringify({ message: "video_saved", jobId: job.jobId, key, seconds: Math.round((Date.now() - job.startedAt) / 1000) }));
    Object.assign(job, { status: "completed", videoUrl: `/uploads/${key}` });
    job.logs = [...job.logs, "Saved."];
    await this.ctx.storage.put("job", job);
    await this.stop();
  }

  async fail(job, message) {
    Object.assign(job, { status: "failed", error: message });
    job.logs = [...(job.logs || []), `Failed: ${message}`];
    await this.ctx.storage.put("job", job);
    await this.stop().catch(() => {});
    return job;
  }

  // Keep the container up while a render is running even without requests.
  async onActivityExpired() {
    const job = await this.ctx.storage.get("job");
    if (job && !TERMINAL.has(job.status)) {
      this.renewActivityTimeout();
      return;
    }
    await this.stop();
  }
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
