// One Uncle Tommy lecture video job per Durable Object (named by job id).
// The DO starts the render container (video-container/), waiting in line when
// every renderer is busy, polls it on a schedule so the job finishes even if
// the CMS tab closes, then copies the MP4 into R2 under lectures/ and stops
// the container. The job steps live in video-job.js.
import { Container } from "@cloudflare/containers";
import { TERMINAL, poll, resumeStalled, startJob, tryStart } from "./video-job.js";

const MAX_RUN_MS = 75 * 60 * 1000; // video-job.js MAX_JOB_MS (60m) plus time to save

export class VideoContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "1m";

  // The server is PID 1 in its container and has no SIGTERM handler, so the
  // default SIGTERM stop is ignored and the container keeps running (and billing).
  async stop() {
    await this.destroy();
  }

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => resumeStalled(this));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/start") return startJob(this, await request.json());
    if (request.method === "GET" && url.pathname === "/status") return Response.json((await this.ctx.storage.get("job")) || { status: "missing" });
    return new Response("Not found", { status: 404 });
  }

  // Scheduled callbacks (this.schedule(seconds, "poll" | "tryStart")).
  tryStart() {
    return tryStart(this);
  }

  poll() {
    return poll(this);
  }

  // Keep the container up while a render is running even without requests.
  async onActivityExpired() {
    const job = await this.ctx.storage.get("job");
    // Never keep a container billing past the job limit, even if the poll chain died.
    const overdue = job && Date.now() - (job.startedAt || 0) > MAX_RUN_MS;
    if (job && !TERMINAL.has(job.status) && !overdue) {
      this.renewActivityTimeout();
      return;
    }
    if (overdue && !TERMINAL.has(job.status)) {
      job.status = "failed";
      job.error = "Video generation took too long.";
      await this.ctx.storage.put("job", job);
    }
    await this.stop();
  }
}
