function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function resolveVideoUrl(baseUrl, videoUrl) {
  const raw = String(videoUrl || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return raw.startsWith("/") ? raw : `/${raw}`;
  return `${base}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function pickVideoUrl(payload) {
  if (!payload || typeof payload !== "object") return null;

  const direct =
    payload.video_url ||
    payload.videoUrl ||
    payload.output_url ||
    payload.outputUrl ||
    payload.download_url ||
    payload.downloadUrl ||
    payload.url;

  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const segments = payload.segments || payload.video_segments || payload.clips;
  if (Array.isArray(segments)) {
    for (const segment of segments) {
      const segmentUrl =
        (typeof segment === "string" && segment) ||
        segment?.video_url ||
        segment?.videoUrl ||
        segment?.url;
      if (typeof segmentUrl === "string" && segmentUrl.trim()) {
        return segmentUrl.trim();
      }
    }
  }

  return null;
}

function isVideoJobTerminal(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "completed" || normalized === "failed" || normalized === "cancelled";
}

function isVideoJobFailure(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "failed" || normalized === "cancelled" || normalized === "error";
}

async function parseJsonResponse(res, { allowStatuses } = {}) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || res.statusText };
  }

  const allowed = allowStatuses ? new Set(allowStatuses) : null;
  const ok = allowed ? allowed.has(res.status) : res.ok;
  if (!ok) {
    const message =
      data?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      data?.error?.message ||
      text ||
      `Video API returned ${res.status}.`;
    throw new Error(message);
  }
  return data;
}

function normalizeJobPayload(baseUrl, payload) {
  const jobId = payload?.id || payload?.job_id || payload?.jobId || null;
  const status = String(payload?.status || "unknown").toLowerCase();
  const logs = Array.isArray(payload?.logs) ? payload.logs : [];
  const error =
    typeof payload?.error === "string"
      ? payload.error
      : payload?.error?.message || null;
  const rawVideoUrl = pickVideoUrl(payload);
  const videoUrl = rawVideoUrl ? resolveVideoUrl(baseUrl, rawVideoUrl) : null;

  return {
    jobId,
    status,
    logs,
    error,
    videoUrl,
    multiSegment: !!payload?.multi_segment,
    segmentCount: Number(payload?.segment_count) || 0,
    segmentsDone: Number(payload?.segments_done) || 0,
    raw: payload,
  };
}

async function startVideoJob(baseUrl, text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("Script text is required.");
  }

  const root = normalizeBaseUrl(baseUrl);
  if (!root) {
    throw new Error("Video generator API URL is not configured.");
  }

  const res = await fetch(`${root}/api/video`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: trimmed }),
  });

  const data = await parseJsonResponse(res, { allowStatuses: new Set([202]) });
  const jobId = data?.job_id || data?.jobId || data?.id;
  if (!jobId) {
    throw new Error("Video API did not return a job id.");
  }

  return {
    jobId,
    status: String(data?.status || "queued").toLowerCase(),
    statusUrl: data?.status_url || `/api/jobs/${jobId}`,
  };
}

async function getVideoJob(baseUrl, jobId) {
  const root = normalizeBaseUrl(baseUrl);
  const id = String(jobId || "").trim();
  if (!root) {
    throw new Error("Video generator API URL is not configured.");
  }
  if (!id) {
    throw new Error("Job id is required.");
  }

  const res = await fetch(`${root}/api/jobs/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  });

  const data = await parseJsonResponse(res);
  return normalizeJobPayload(root, data);
}

module.exports = {
  normalizeBaseUrl,
  resolveVideoUrl,
  isVideoJobTerminal,
  isVideoJobFailure,
  startVideoJob,
  getVideoJob,
};
