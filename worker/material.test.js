import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { handleMaterialApi } from "./material.js";
import { developerToken, memoryD1, memoryR2 } from "./test-env.js";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// A media container that answers each path from routes.
function media(routes) {
  const calls = [];
  return {
    calls,
    getByName() {
      return {
        async fetch(request) {
          const path = new URL(request.url).pathname;
          calls.push(path);
          const respond = routes[path];
          if (!respond) return new Response("Not found", { status: 404 });
          return respond(request);
        },
      };
    },
  };
}

async function setup(extra = {}) {
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), CMS_API_BASE: "https://cms.test", ...extra };
  const token = await developerToken(handleStoreApi, env);
  const send = async (body) => {
    const url = new URL("https://class.lango.ai/api/cms/extract-material");
    const isForm = body instanceof FormData;
    const request = new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...(isForm ? {} : { "content-type": "application/json" }) },
      body: isForm ? body : JSON.stringify(body),
    });
    const response = await handleMaterialApi(request, env, url);
    return { status: response.status, body: await response.json() };
  };
  return { env, send };
}

function form(...files) {
  const data = new FormData();
  for (const file of files) data.append("files", file);
  return data;
}

const JPEG_B64 = btoa("jpeg-bytes");

test("a Word file is read in the container and its pictures become material assets", async () => {
  const MEDIA = media({
    "/docx": () => Response.json({ text: "Lesson one\n\nApples are red." }),
    "/docx/images": () => Response.json({ images: [{ jpeg: JPEG_B64, name: "apple.png", width: 300, height: 200 }] }),
  });
  const { env, send } = await setup({ MEDIA });
  const { status, body } = await send(form(new File(["x"], "Lesson.docx")));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.text, "Lesson one\n\nApples are red.");
  assert.equal(body.format, "docx");
  assert.deepEqual(body.extraction.methods, ["docx"]);
  assert.equal(body.imageAssetCount, 1);
  assert.equal(body.imageAssets[0].label, "Lesson · apple.png");
  assert.ok(await env.UPLOADS.head(body.imageAssets[0].url.slice(1)));
});

test("a text PDF uses its text; a scanned one is read page by page with the vision model", async () => {
  let pdfText = "Chapter 1. ".repeat(20);
  const MEDIA = media({
    "/pdf": () => Response.json({ text: pdfText }),
    "/pdf/images": () => Response.json({ images: [] }),
    "/pdf/screenshots": () => Response.json({ pages: [{ pageNumber: 1, base64: JPEG_B64, mime: "image/png" }] }),
  });
  const { send } = await setup({ MEDIA, OPENROUTER_API_KEY: "or" });
  const text = await send(form(new File(["x"], "book.pdf", { type: "application/pdf" })));
  assert.deepEqual(text.body.extraction.methods, ["pdf-text"]);

  pdfText = "x";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    const sent = JSON.parse(init.body);
    assert.equal(sent.model, "google/gemini-2.5-flash");
    assert.match(sent.messages[0].content[0].image_url.url, /^data:image\/png;base64,/);
    return Response.json({ choices: [{ message: { content: "## Fruit\n\n- apple" } }] });
  };
  const scanned = await send(form(new File(["x"], "scan.pdf", { type: "application/pdf" })));
  assert.equal(scanned.status, 200, JSON.stringify(scanned.body));
  assert.equal(scanned.body.text, "## Page 1\n\n## Fruit\n\n- apple");
  assert.equal(scanned.body.extraction.usedVisionOcr, true);
  assert.equal(scanned.body.extraction.pagesProcessed, 1);
});

test("pictures need an OpenRouter key and say so instead of waiting", async () => {
  const { send } = await setup({ MEDIA: media({}) });
  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch ${url}`);
  };
  const { status, body } = await send(form(new File(["x"], "board.jpg", { type: "image/jpeg" })));
  assert.equal(status, 400);
  assert.match(body.message, /OPENROUTER_API_KEY/);
});

test("a photo is described and kept as an image asset", async () => {
  const MEDIA = media({ "/image/normalize": () => Response.json({ jpeg: JPEG_B64, width: 800, height: 600 }) });
  const { send } = await setup({ MEDIA, OPENROUTER_API_KEY: "or" });
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "## Board\n\ncat, dog" } }] });
  const { status, body } = await send(form(new File(["x"], "board.jpg", { type: "image/jpeg" })));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.source, "image");
  assert.equal(body.text, "## Board\n\ncat, dog");
  assert.equal(body.imageAssets[0].origin, "upload");
});

test("text and caption files are read directly, and several files are combined", async () => {
  const { send } = await setup({ MEDIA: media({}) });
  const { status, body } = await send(
    form(
      new File(["Hello   \n\n\n\nworld"], "notes.txt", { type: "text/plain" }),
      new File(["WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nGood morning\n"], "talk.vtt")
    )
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.source, "files");
  assert.equal(body.text, "## notes.txt\n\nHello\n\nworld\n\n---\n\n## talk.vtt\n\nGood morning");
});

test("short MP3 audio is transcribed through the keyless router", async () => {
  const { send } = await setup({ MEDIA: media({}) });
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://cms.test/api/router/transcribe");
    return Response.json({ text: "The cat sat down." });
  };
  const { status, body } = await send(form(new File(["ID3"], "Story time.mp3", { type: "audio/mpeg" })));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.source, "audio");
  assert.equal(body.text, "## Story time\n\nThe cat sat down.");
});

test("video, long audio and PowerPoint answer 501 at once", async () => {
  const { send } = await setup({ MEDIA: media({}) });
  for (const file of [
    new File(["x"], "clip.mp4", { type: "video/mp4" }),
    new File(["x"], "talk.m4a", { type: "audio/mp4" }),
    new File(["x"], "deck.pptx"),
  ]) {
    const { status, body } = await send(form(file));
    assert.equal(status, 501, file.name);
    assert.ok(body.message.length > 20);
  }
  assert.equal((await send({ videoUrl: "/uploads/videos/a.mp4" })).status, 501);
});

test("pasted text and caption URLs work without a file", async () => {
  const { env, send } = await setup();
  const pasted = await send({ text: "a".repeat(30), maxChars: 10 });
  assert.equal(pasted.body.source, "text");
  assert.equal(pasted.body.truncated, true);

  await env.UPLOADS.put("uploads/captions/c.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi there\n");
  const caption = await send({ captionUrl: "/uploads/captions/c.vtt" });
  assert.equal(caption.status, 200);
  assert.equal(caption.body.text, "Hi there");
  assert.equal((await send({})).status, 400);
});
