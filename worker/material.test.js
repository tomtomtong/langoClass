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
  const { send } = await setup({ MEDIA, INWORLD_API_KEY: "iw" });
  const text = await send(form(new File(["x"], "book.pdf", { type: "application/pdf" })));
  assert.deepEqual(text.body.extraction.methods, ["pdf-text"]);

  pdfText = "x";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.inworld.ai/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Basic iw");
    const sent = JSON.parse(init.body);
    assert.equal(sent.model, "google-ai-studio/gemini-2.5-flash");
    assert.match(sent.messages[0].content[0].image_url.url, /^data:image\/png;base64,/);
    return Response.json({ choices: [{ message: { content: "## Fruit\n\n- apple" } }] });
  };
  const scanned = await send(form(new File(["x"], "scan.pdf", { type: "application/pdf" })));
  assert.equal(scanned.status, 200, JSON.stringify(scanned.body));
  assert.equal(scanned.body.text, "## Page 1\n\n## Fruit\n\n- apple");
  assert.equal(scanned.body.extraction.usedVisionOcr, true);
  assert.equal(scanned.body.extraction.pagesProcessed, 1);
});

test("pictures need an Inworld key and say so instead of waiting", async () => {
  const { send } = await setup({ MEDIA: media({}), OPENROUTER_API_KEY: "or" });
  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch ${url}`);
  };
  const { status, body } = await send(form(new File(["x"], "board.jpg", { type: "image/jpeg" })));
  assert.equal(status, 400);
  assert.match(body.message, /INWORLD_API_KEY/);
});

test("a photo is described and kept as an image asset", async () => {
  const MEDIA = media({ "/image/normalize": () => Response.json({ jpeg: JPEG_B64, width: 800, height: 600 }) });
  const { send } = await setup({ MEDIA, INWORLD_API_KEY: "iw" });
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

// Two 25-second MP3 pieces from the container, and a router that hears one
// line per piece.
function speechSetup(lines = ["Good morning class", "Open your books"]) {
  const MEDIA = media({
    "/audio/chunks": () =>
      Response.json({ chunks: lines.map((_, index) => ({ base64: btoa(`mp3-${index}`), format: "mp3", durationMs: 1500 })) }),
  });
  let heard = 0;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://cms.test/api/router/transcribe");
    return Response.json({ text: lines[heard++] || "" });
  };
  return MEDIA;
}

test("a video is kept in R2 and the captions made from its sound become the material", async () => {
  const MEDIA = speechSetup();
  const { env, send } = await setup({ MEDIA });
  const { status, body } = await send(form(new File(["video"], "Lesson 1.mov", { type: "video/quicktime" })));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.source, "video");
  assert.equal(body.text, "## Lesson 1\n\nGood morning class Open your books");
  assert.deepEqual(MEDIA.calls, ["/audio/chunks"], "a video under 12 MB is not shrunk");
  assert.match(body.videoUrl, /^\/uploads\/videos\/material-\d+-[a-f0-9]{8}\.mov$/);
  assert.ok(await env.UPLOADS.head(body.videoUrl.slice(1)));
  assert.equal(body.cueCount, 1);
  const vtt = await (await env.UPLOADS.get(body.captionUrl.slice(1))).text();
  assert.equal(vtt, "WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\nGood morning class Open your books\n");
});

test("with an Inworld key, captions use Whisper word timings from each piece", async () => {
  const MEDIA = media({
    "/audio/chunks": () =>
      Response.json({ chunks: [0, 1].map((index) => ({ base64: btoa(`mp3-${index}`), format: "mp3", durationMs: 25000 })) }),
  });
  const sent = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.inworld.ai/stt/v1/transcribe");
    sent.push(JSON.parse(init.body).transcribeConfig);
    const words = sent.length === 1 ? [{ word: "你好", startTimeMs: 1000, endTimeMs: 1600 }] : [{ word: "再見", startTimeMs: 2000, endTimeMs: 2500 }];
    return Response.json({ transcription: { transcript: words[0].word, wordTimestamps: words } });
  };
  const { env, send } = await setup({ MEDIA, INWORLD_API_KEY: "iw" });
  const { status, body } = await send(form(new File(["video"], "talk.mp4", { type: "video/mp4" })));
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(
    sent.map((config) => [config.modelId, config.includeWordTimestamps, config.audioEncoding]),
    [["groq/whisper-large-v3", true, "MP3"], ["groq/whisper-large-v3", true, "MP3"]]
  );
  const vtt = await (await env.UPLOADS.get(body.captionUrl.slice(1))).text();
  assert.equal(vtt, "WEBVTT\n\n1\n00:00:01.000 --> 00:00:01.600\n你好\n\n2\n00:00:27.000 --> 00:00:27.500\n再見\n");
});

test("a video over 12 MB is shrunk in the container before it is kept", async () => {
  const MEDIA = speechSetup(["Hello"]);
  const shrunk = new Uint8Array(1000);
  const calls = MEDIA.calls;
  const inner = MEDIA.getByName();
  MEDIA.getByName = () => ({
    async fetch(request) {
      if (new URL(request.url).pathname !== "/video/compress") return inner.fetch(request);
      calls.push("/video/compress");
      assert.equal(request.headers.get("x-max-bytes"), String(12 * 1024 * 1024));
      return new Response(shrunk, { headers: { "x-compressed": "1" } });
    },
  });
  const { env, send } = await setup({ MEDIA });
  const big = new File([new Uint8Array(13 * 1024 * 1024)], "big.webm", { type: "video/webm" });
  const { status, body } = await send(form(big));
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(calls, ["/video/compress", "/audio/chunks"]);
  assert.match(body.videoUrl, /\.mp4$/);
  assert.equal((await env.UPLOADS.head(body.videoUrl.slice(1))).size, 1000);
});

test("long audio is cut into pieces and the pieces are joined", async () => {
  const MEDIA = speechSetup(["First part", "", "Last part"]);
  const { send } = await setup({ MEDIA });
  const { status, body } = await send(form(new File(["m4a"], "talk.m4a", { type: "audio/mp4" })));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.source, "audio");
  assert.equal(body.text, "## talk\n\nFirst part Last part");
});

test("a file with no sound and PowerPoint say what to do instead", async () => {
  const MEDIA = media({ "/audio/chunks": () => Response.json({ chunks: [] }) });
  const { send } = await setup({ MEDIA });
  const silent = await send(form(new File(["x"], "clip.mp4", { type: "video/mp4" })));
  assert.equal(silent.status, 400);
  assert.match(silent.body.message, /No audio track/);
  const deck = await send(form(new File(["x"], "deck.pptx")));
  assert.equal(deck.status, 501);
  assert.match(deck.body.message, /PDF/);
});

test("a videoUrl in R2 is captioned; a missing one answers 404", async () => {
  const { env, send } = await setup({ MEDIA: speechSetup(["Hi there"]) });
  await env.UPLOADS.put("uploads/videos/a.mp4", "video");
  const { status, body } = await send({ videoUrl: "/uploads/videos/a.mp4", language: "zh-HK" });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.source, "video");
  assert.equal(body.text, "Hi there");
  assert.ok(await env.UPLOADS.head(body.captionUrl.slice(1)));
  assert.equal((await send({ videoUrl: "/uploads/videos/gone.mp4" })).status, 404);
  assert.equal((await send({ videoUrl: "https://youtu.be/abc" })).status, 400);
});

test("compress-material-video returns the container's smaller MP4", async () => {
  const MEDIA = media({ "/video/compress": () => new Response(new Uint8Array(10), { headers: { "x-compressed": "1" } }) });
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), MEDIA };
  const token = await developerToken(handleStoreApi, env);
  const post = async (file) => {
    const data = new FormData();
    data.set("file", file);
    const url = new URL("https://class.lango.ai/api/cms/compress-material-video");
    return handleMaterialApi(new Request(url, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: data }), env, url);
  };
  const big = await post(new File([new Uint8Array(13 * 1024 * 1024)], "big.mov", { type: "video/quicktime" }));
  assert.equal(big.status, 200);
  assert.equal(big.headers.get("content-type"), "video/mp4");
  assert.equal(big.headers.get("x-compressed"), "1");
  assert.equal(big.headers.get("x-output-bytes"), "10");
  assert.equal((await big.arrayBuffer()).byteLength, 10);

  const small = await post(new File(["tiny"], "small.mp4", { type: "video/mp4" }));
  assert.equal(small.headers.get("x-compressed"), "0");
  assert.equal(await small.text(), "tiny");
  assert.deepEqual(MEDIA.calls, ["/video/compress"]);
  assert.equal((await post(new File(["x"], "notes.txt", { type: "text/plain" }))).status, 400);
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
