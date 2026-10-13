import assert from "node:assert/strict";
import test from "node:test";
import { handleVideoRequest } from "./video.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("starting a video falls back to the classroom server and does not send a generator address", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const body = JSON.parse(init.body);
    assert.equal(body.text, "Hello class.");
    assert.equal(body.videoGeneratorApiUrl, undefined);
    if (String(url).endsWith("/api/video")) return jsonResponse({ message: "missing" }, 404);
    assert.equal(String(url), "https://classroom.lango.ai/api/cms/generate-video");
    assert.equal(init.headers.get("authorization"), "Bearer teacher");
    return jsonResponse({ ok: true, jobId: "job-42", status: "queued" }, 202);
  };
  try {
    const response = await handleVideoRequest(
      new Request("https://class.lango.ai/api/video", {
        method: "POST",
        headers: { authorization: "Bearer teacher", "x-teacher-id": "835" },
        body: JSON.stringify({
          text: "Hello class.",
          videoGeneratorApiUrl: "https://should-not-be-forwarded.example",
        }),
      }),
      { ORIGIN: "https://classroom.lango.ai" },
      new URL("https://class.lango.ai/api/video")
    );
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("x-video-runtime"), "backend");
    assert.deepEqual(await response.json(), { ok: true, jobId: "job-42", status: "queued" });
    assert.deepEqual(calls, [
      "https://classroom.lango.ai/api/video",
      "https://classroom.lango.ai/api/cms/generate-video",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("a finished job returns the video URL from the backend without waiting", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://classroom.lango.ai/api/video/job-42");
    return jsonResponse({
      ok: true,
      jobId: "job-42",
      status: "completed",
      videoUrl: "https://classroom.lango.ai/uploads/videos/lesson.mp4",
    });
  };
  try {
    const response = await handleVideoRequest(
      new Request("https://class.lango.ai/video/job-42"),
      { ORIGIN: "https://classroom.lango.ai" },
      new URL("https://class.lango.ai/video/job-42")
    );
    assert.equal(response.headers.get("x-video-runtime"), "backend");
    const body = await response.json();
    assert.equal(body.videoUrl, "https://classroom.lango.ai/uploads/videos/lesson.mp4");
  } finally {
    globalThis.fetch = original;
  }
});

test("a job id cannot leave the video route", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse({ ok: true });
  };
  try {
    const response = await handleVideoRequest(
      new Request("https://class.lango.ai/api/video/..%2Fconfig"),
      { ORIGIN: "https://classroom.lango.ai" },
      new URL("https://class.lango.ai/api/video/..%2Fconfig")
    );
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
