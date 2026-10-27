import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { PART_BYTES } from "./course-files.js";
import { streamFormFile } from "./course-media.js";
import { api, developerToken, getDoc, memoryD1, memoryR2, putDoc } from "./test-env.js";

async function setup() {
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), ORIGIN: "" };
  await env.UPLOADS.put("uploads/courses/old.png", "old");
  await putDoc(env, "teacher-courses", {
    courses: [{
      id: -5,
      teacherId: 835,
      name: "Shapes",
      banner: "/uploads/courses/old.png",
      sections: [{ id: 1, title: "Circles", banner: "", introVideoUrl: "" }],
    }],
  });
  const token = await developerToken(handleStoreApi, env);
  return { env, call: api(handleStoreApi, env, token) };
}

function upload(field, bytes, name, type) {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), name);
  return form;
}

test("a course banner goes to R2, the course points at it, and the old file goes", async () => {
  const { env, call } = await setup();
  const response = await call("/api/cms/courses/-5/banner", {
    method: "POST",
    body: upload("banner", new Uint8Array([1, 2, 3]), "b.PNG", "image/png"),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.url, /^\/uploads\/courses\/course--5-\d+\.png$/);
  assert.equal(body.course.banner, body.url);
  assert.equal((await getDoc(env, "teacher-courses")).courses[0].banner, body.url);
  assert.equal(env.UPLOADS.objects.get(body.url.slice(1)).httpMetadata.contentType, "image/png");
  assert.equal(env.UPLOADS.objects.has("uploads/courses/old.png"), false);
});

test("banners refuse other file types and large images", async () => {
  const { call } = await setup();
  const pdf = await call("/api/cms/courses/-5/banner", { method: "POST", body: upload("banner", "x", "a.pdf", "application/pdf") });
  assert.equal((await pdf.json()).message, "Only JPEG, PNG, WebP, or GIF images are allowed.");
  const big = await call("/api/cms/courses/-5/sections/1/banner", {
    method: "POST",
    body: upload("banner", new Uint8Array(2 * 1024 * 1024 + 1), "a.png", "image/png"),
  });
  assert.equal((await big.json()).message, "Image file is too large (max 2 MB).");
});

test("a section banner updates that section", async () => {
  const { env, call } = await setup();
  const body = await (await call("/api/cms/courses/-5/sections/1/banner", {
    method: "POST",
    body: upload("banner", "img", "s.webp", "image/webp"),
  })).json();
  assert.match(body.url, /^\/uploads\/sections\/section--5-1-\d+\.webp$/);
  assert.equal(body.section.banner, body.url);
  assert.equal((await getDoc(env, "teacher-courses")).courses[0].sections[0].banner, body.url);
});

test("an intro video larger than one R2 part is streamed up in parts", async () => {
  const { env, call } = await setup();
  const video = new Uint8Array(PART_BYTES + 12345);
  for (let i = 0; i < video.length; i += 4096) video[i] = i % 251;
  const response = await call("/api/cms/courses/-5/sections/1/intro-video", {
    method: "POST",
    body: upload("video", video, "clip.mov", "video/quicktime"),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.url, /^\/uploads\/videos\/material-\d+-\w{8}\.mov$/);
  const stored = env.UPLOADS.objects.get(body.url.slice(1));
  assert.equal(stored.multipart, 2);
  assert.deepEqual(stored.bytes, video);
  assert.equal((await getDoc(env, "teacher-courses")).courses[0].sections[0].introVideoUrl, body.url);
});

test("an intro video needs a saved section", async () => {
  const { call } = await setup();
  const response = await call("/api/cms/courses/-5/sections/7/intro-video", {
    method: "POST",
    body: upload("video", "v", "a.mp4", "video/mp4"),
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).message, "Section not found.");
});

test("the form reader finds the file when the boundary is split across reads", async () => {
  const boundary = "----lango";
  const file = "hello\r\n--almost-a-boundary but not\r\nbye";
  const raw = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="a.mp4"\r\nContent-Type: video/mp4\r\n\r\n${file}\r\n--${boundary}--\r\n`
  );
  let at = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (at >= raw.length) return controller.close();
      controller.enqueue(raw.slice(at, at + 7));
      at += 7;
    },
  });
  const request = new Request("https://class.lango.ai/x", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
    duplex: "half",
  });
  const parsed = await streamFormFile(request, "video", 1000);
  assert.equal(parsed.filename, "a.mp4");
  assert.equal(parsed.contentType, "video/mp4");
  assert.equal(await new Response(parsed.body).text(), file);
});

test("deleting a course removes its banner from R2", async () => {
  const { env, call } = await setup();
  const response = await call("/api/cms/courses/-5", { method: "DELETE" });
  assert.equal(response.status, 200);
  assert.equal(env.UPLOADS.objects.has("uploads/courses/old.png"), false);
  assert.equal((await getDoc(env, "teacher-courses")).courses.length, 0);
});

test("a question image for a course goes to R2", async () => {
  const { env, call } = await setup();
  const response = await call("/api/cms/courses/-5/question-image", {
    method: "POST",
    headers: { "x-teacher-id": "835" },
    body: upload("image", new Uint8Array([4, 5, 6]), "q.jpeg", "image/jpeg"),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.url, /^\/uploads\/questions\/question-835-\d+\.jpeg$/);
  assert.deepEqual(env.UPLOADS.objects.get(body.url.slice(1)).bytes, new Uint8Array([4, 5, 6]));
});

test("a question image for an unknown course is refused before upload", async () => {
  const { env, call } = await setup();
  const response = await call("/api/cms/courses/-99/question-image", {
    method: "POST",
    body: upload("image", "x", "q.png", "image/png"),
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).message, "Course not found.");
  assert.equal([...env.UPLOADS.objects.keys()].some((key) => key.startsWith("uploads/questions/")), false);
});

test("the CMS question image route needs no course and checks the file", async () => {
  const { call } = await setup();
  const ok = await (await call("/api/cms/question-image", {
    method: "POST",
    body: upload("image", "png", "q.png", "image/png"),
  })).json();
  assert.match(ok.url, /^\/uploads\/questions\/question-upload-\d+\.png$/);
  const missing = await call("/api/cms/question-image", { method: "POST", body: new FormData() });
  assert.equal((await missing.json()).message, "No image file provided.");
});
