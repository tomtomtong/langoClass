// Uncle Tommy lecture video jobs for the CMS. Each job runs in its own
// VideoContainer (worker/video-container.js, image in video-container/): the
// lesson plan and voice come from the newcms router, HyperFrames renders the
// video, and the MP4 lands in R2 under lectures/. The CMS starts a job and
// polls it; the response shape is the one it already reads.
import { requireTeacher } from "./d1-store.js";

export async function handleVideoRequest(request, env, url) {
  const target = videoTarget(request.method, url.pathname);
  if (!target) return null;
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return tag(auth);
  if (!env.VIDEO) return json({ message: "The video renderer is not configured." }, 500);

  if (target.kind === "start") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ message: "Send a JSON body." }, 400);
    }
    const text = String(body?.text || "").trim().slice(0, 100000);
    if (!text) return json({ message: "Script text is required." }, 400);
    const jobId = crypto.randomUUID().replace(/-/g, "");
    try {
      const res = await env.VIDEO.getByName(jobId).fetch("http://video/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, text, routerBase: routerBase(env) }),
      });
      const job = await res.json();
      if (!res.ok) return json({ message: job?.error || "Could not start video generation." }, 502);
      return json({ ok: true, jobId, status: job.status }, 202);
    } catch (error) {
      return failure("video_start", error, "Could not start video generation.");
    }
  }

  let jobId;
  try {
    jobId = safeJobId(target.jobId);
  } catch {
    return json({ message: "Job id is required." }, 400);
  }
  try {
    const res = await env.VIDEO.getByName(jobId).fetch("http://video/status");
    const job = await res.json();
    if (job.status === "missing") return json({ message: "Video job not found." }, 404);
    return json({
      ok: true,
      jobId,
      status: job.status,
      logs: job.logs,
      error: job.error,
      videoUrl: job.videoUrl,
      multiSegment: false,
      segmentCount: job.segmentCount,
      segmentsDone: job.segmentsDone,
    }, 200);
  } catch (error) {
    return failure("video_status", error, "Could not fetch video job status.");
  }
}

function videoTarget(method, pathname) {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (method === "POST" && (path === "/video" || path === "/api/video" || path === "/api/cms/generate-video")) {
    return { kind: "start" };
  }
  const match = path.match(/^\/(?:api\/)?video\/([^/]+)$/) || path.match(/^\/api\/cms\/video-jobs\/([^/]+)$/);
  if (method === "GET" && match) return { kind: "status", jobId: match[1] };
  return null;
}

function safeJobId(value) {
  const id = decodeURIComponent(String(value || "").trim());
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Job id is required.");
  return id;
}

function routerBase(env) {
  const cms = String(env?.CMS_API_BASE || "https://newcms.lango.ai").replace(/\/$/, "");
  return `${cms}/api/router`;
}

function failure(label, error, fallback) {
  const message = error instanceof Error ? error.message : String(error || "");
  console.error(JSON.stringify({ message: `${label}_failed`, error: message }));
  return json({ message: message || fallback }, 502);
}

function tag(response) {
  const headers = new Headers(response.headers);
  headers.set("x-video-runtime", "worker");
  return new Response(response.body, { status: response.status, headers });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-video-runtime": "worker" },
  });
}
