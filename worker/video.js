// The classroom starts a video job and later reads its URL.
// video-generator.js stays on the classroom server, which waits for the job.

export async function handleVideoRequest(request, env, url) {
  const target = videoTarget(request.method, url.pathname);
  if (!target) return null;
  const origin = String(env?.ORIGIN || "").replace(/\/$/, "");
  if (!origin) return json({ message: "Video backend is not configured." }, 500);

  try {
    if (target.kind === "start") return await startVideo(request, origin);
    return await readVideo(request, origin, target.jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid video request.";
    if (message === "Script text is required." || message === "Job id is required.") {
      return json({ message }, 400);
    }
    console.error(
      JSON.stringify({
        message: "video_request_failed",
        error: message,
      })
    );
    return json({ message: "Video backend unavailable." }, 502);
  }
}

async function startVideo(request, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Send a JSON body." }, 400);
  }
  const text = String(body?.text || "").trim().slice(0, 100000);
  if (!text) return json({ message: "Script text is required." }, 400);
  const payload = { text };
  const headers = forwardedAuth(request);
  const dedicated = await postJson(`${origin}/api/video`, payload, headers);
  if (dedicated.status !== 404 && dedicated.status !== 405) return tagBackend(dedicated);
  return tagBackend(await postJson(`${origin}/api/cms/generate-video`, payload, headers));
}

async function readVideo(request, origin, jobId) {
  const id = safeJobId(jobId);
  const headers = forwardedAuth(request);
  const dedicated = await fetch(`${origin}/api/video/${encodeURIComponent(id)}`, { headers });
  if (dedicated.status !== 404 && dedicated.status !== 405) return tagBackend(dedicated);
  return tagBackend(await fetch(`${origin}/api/cms/video-jobs/${encodeURIComponent(id)}`, { headers }));
}

function videoTarget(method, pathname) {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (method === "POST" && (path === "/video" || path === "/api/video")) return { kind: "start" };
  const match = path.match(/^\/(?:api\/)?video\/([^/]+)$/);
  if (method === "GET" && match) return { kind: "status", jobId: match[1] };
  return null;
}

function safeJobId(value) {
  let id = String(value || "").trim();
  try {
    id = decodeURIComponent(id);
  } catch {
    throw new Error("Job id is required.");
  }
  if (!id || id.length > 200 || /[/\\]|\.\./.test(id)) throw new Error("Job id is required.");
  return id;
}

function forwardedAuth(request) {
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const teacher = request.headers.get("x-teacher-id");
  if (authorization) headers.set("authorization", authorization);
  if (teacher) headers.set("x-teacher-id", teacher);
  return headers;
}

async function postJson(url, body, authHeaders) {
  const headers = new Headers(authHeaders || {});
  headers.set("content-type", "application/json");
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function tagBackend(response) {
  const headers = new Headers(response.headers);
  headers.set("x-video-runtime", "backend");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-video-runtime": "backend" },
  });
}
