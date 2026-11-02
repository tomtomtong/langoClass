// Video generation jobs, as server.js handleBackendVideoStart/Status served
// them: the newcms video API makes the video and the CMS polls the job.
// lib/video-generator.js holds the request and job shapes.
import videoGenerator from "../lib/video-generator.js";
import { requireTeacher } from "./d1-store.js";

export async function handleVideoRequest(request, env, url) {
  const target = videoTarget(request.method, url.pathname);
  if (!target) return null;
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return tag(auth);
  const base = videoBase(env);

  if (target.kind === "start") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ message: "Send a JSON body." }, 400);
    }
    const text = String(body?.text || "").trim().slice(0, 100000);
    if (!text) return json({ message: "Script text is required." }, 400);
    try {
      const started = await videoGenerator.startVideoJob(base, text);
      return json({ ok: true, jobId: started.jobId, status: started.status }, 202);
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
    const job = await videoGenerator.getVideoJob(base, jobId);
    return json({
      ok: true,
      jobId: job.jobId || jobId,
      status: job.status,
      logs: job.logs,
      error: job.error,
      videoUrl: job.videoUrl,
      multiSegment: job.multiSegment,
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
  let id = String(value || "").trim();
  id = decodeURIComponent(id);
  if (!id || id.length > 200 || /[/\\]|\.\./.test(id)) throw new Error("Job id is required.");
  return id;
}

function videoBase(env) {
  return String(env?.VIDEO_GENERATOR_API_URL || env?.CMS_API_BASE || "https://newcms.lango.ai").replace(/\/$/, "");
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
