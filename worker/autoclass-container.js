// One autoclass lesson render per Durable Object (named by job id), in the same image as the
// lecture videos (video-container/, routes under /autoclass/jobs). Works like VideoContainer:
// waits in line for a free renderer, polls on a schedule so the job finishes with no page open,
// then saves the lesson folder into R2 (autoclass-job.js) and stops the container.
import { Container } from "@cloudflare/containers";
import { DurableObject, env as workerEnv } from "cloudflare:workers";
import { TERMINAL, poll, resumeStalled, startJob, tryStart } from "./video-job.js";
import { AUTOCLASS_PATHS, devRenderer, saveLessonRender } from "./autoclass-job.js";

const MAX_RUN_MS = 75 * 60 * 1000; // video-job.js MAX_JOB_MS (60m) plus time to save

// With the local renderer (devRenderer) there is no container to start, and the Container class
// refuses to exist under `wrangler dev --enable-containers=false`; this stands in for the little
// of it the job uses: one scheduled step at a time on the object's alarm.
class LocalRendererObject extends DurableObject {
  async schedule(seconds, callback) {
    await this.ctx.storage.put("scheduled", callback);
    await this.ctx.storage.setAlarm(Date.now() + seconds * 1000);
  }

  async alarm() {
    const callback = await this.ctx.storage.get("scheduled");
    await this.ctx.storage.delete("scheduled");
    if (callback && typeof this[callback] === "function") await this[callback]();
  }

  renewActivityTimeout() {}
}

const Base = devRenderer(workerEnv) ? LocalRendererObject : Container;

export class AutoclassContainer extends Base {
  defaultPort = 8080;
  sleepAfter = "1m";
  paths = AUTOCLASS_PATHS;
  startedStatus = "voicing";

  // The server is PID 1 and ignores SIGTERM (see VideoContainer).
  async stop() {
    if (devRenderer(this.env)) return;
    await this.destroy();
  }

  async containerFetch(input, init, port) {
    const local = devRenderer(this.env);
    if (!local) return super.containerFetch(input, init, port);
    const url = new URL(typeof input === "string" ? input : input.url);
    return fetch(`${local}${url.pathname}${url.search}`, init);
  }

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => resumeStalled(this));
  }

  saveOutput(job, state) {
    return saveLessonRender(this, job, state);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/start") return startJob(this, await request.json());
    if (request.method === "GET" && url.pathname === "/status") return Response.json((await this.ctx.storage.get("job")) || { status: "missing" });
    return new Response("Not found", { status: 404 });
  }

  tryStart() {
    return tryStart(this);
  }

  poll() {
    return poll(this);
  }

  async onActivityExpired() {
    const job = await this.ctx.storage.get("job");
    const overdue = job && Date.now() - (job.startedAt || 0) > MAX_RUN_MS;
    if (job && !TERMINAL.has(job.status) && !overdue) {
      this.renewActivityTimeout();
      return;
    }
    if (overdue && !TERMINAL.has(job.status)) {
      job.status = "failed";
      job.error = "The lesson render took too long.";
      await this.ctx.storage.put("job", job);
    }
    await this.stop();
  }
}
