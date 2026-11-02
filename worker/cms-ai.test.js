import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { api, developerToken, memoryD1, memoryR2, putDoc } from "./test-env.js";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const CMS = "https://cms.test";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

async function setup(extra = {}) {
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), CMS_API_BASE: CMS, ORIGIN: "https://classroom.lango.ai", ...extra };
  const token = await developerToken(handleStoreApi, env);
  return { env, call: api(handleStoreApi, env, token) };
}

// Answers the newcms router: text from reply(), images as a tiny PNG.
function router(reply) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("classroom.lango.ai")) throw new Error(`Called the old server: ${target}`);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: target, body });
    if (target === `${CMS}/api/router/text`) return Response.json({ text: await reply(body, calls.length) });
    if (target === `${CMS}/api/router/image`) return Response.json({ image: PNG });
    throw new Error(`Unexpected fetch ${target}`);
  };
  return calls;
}

const draft = {
  exercises: [
    {
      type: "mcquiz",
      title: "Animals",
      items: [
        {
          title: "Which animal says meow?",
          options: [
            { text: "Cat", isCorrect: true },
            { text: "Dog", isCorrect: false },
            { text: "Cow", isCorrect: false },
            { text: "Pig", isCorrect: false },
          ],
        },
      ],
    },
  ],
};

test("exercises are generated through the keyless router without the old server", async () => {
  const { call } = await setup();
  const calls = router(() => JSON.stringify(draft));
  const response = await call("/api/cms/generate-exercises", {
    method: "POST",
    json: { material: "Cats say meow. Dogs say woof.", types: { mcquiz: 1 }, countPerType: 1, autoGenerateImages: false },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.exercises[0].items[0].title, "Which animal says meow?");
  assert.equal(body.imageAssetsUsed, 0);
  assert.ok(calls.every((entry) => entry.url === `${CMS}/api/router/text`));
});

test("with an OpenRouter key, generation uses it and the model the teacher picked", async () => {
  const { call } = await setup({ OPENROUTER_API_KEY: "or-key" });
  const sent = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    sent.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify(draft) } }] });
  };
  const response = await call("/api/cms/generate-exercises", {
    method: "POST",
    json: { material: "Cats say meow.", types: { mcquiz: 1 }, countPerType: 1, model: "openai/gpt-5", autoGenerateImages: false },
  });
  assert.equal(response.status, 200);
  assert.equal(sent[0].model, "openai/gpt-5");
});

test("generation reports a model failure as an error, not a hang", async () => {
  const { call } = await setup();
  globalThis.fetch = async () => Response.json({ error: "router down" }, { status: 503 });
  const response = await call("/api/cms/generate-exercises", {
    method: "POST",
    json: { material: "Cats say meow.", types: { mcquiz: 1 }, countPerType: 1, autoGenerateImages: false },
  });
  assert.equal(response.status, 500);
  assert.match((await response.json()).message, /router down/);
});

test("the assistant answers through the router", async () => {
  const { call } = await setup();
  router(() => "Open Course settings, then Sections.");
  const response = await call("/api/cms/assistant", { method: "POST", json: { message: "How do I add a section?" } });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.reply, "Open Course settings, then Sections.");
});

test("a generated question image is stored in R2 under questions/", async () => {
  const { env, call } = await setup();
  router(() => "");
  const response = await call("/api/cms/question-image/generate", { method: "POST", json: { prompt: "a red apple" } });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.url, /^\/uploads\/questions\/question-ai-835-\d+-[a-f0-9]{4}\.png$/);
  assert.ok(await env.UPLOADS.head(body.url.slice(1)));
});

test("a generated path tile becomes the section banner", async () => {
  const { env, call } = await setup();
  await putDoc(env, "teacher-courses", {
    courses: [{ id: -1, teacherId: 835, name: "Food", sections: [{ id: 3, title: "Fruit", banner: "" }] }],
  });
  const calls = router(() => "");
  const response = await call("/api/cms/section-banner/generate", {
    method: "POST",
    json: { sectionTitle: "Fruit", courseName: "Food", courseId: -1, sectionId: 3 },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.url, /^\/uploads\/sections\/section-ai-course--1-section-3-835-\d+\.png$/);
  assert.equal(body.section.banner, body.url);
  assert.match(calls[0].body.prompt, /Lesson theme: "Fruit"/);
  assert.ok(await env.UPLOADS.head(body.url.slice(1)));
});

test("captions in R2 are translated into a new caption file", async () => {
  const { env, call } = await setup();
  await env.UPLOADS.put("uploads/captions/en.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n\n00:00:02.000 --> 00:00:03.000\nGoodbye\n");
  router(() => "1. 你好\n2. 再見");
  const response = await call("/api/cms/translate-video-captions", {
    method: "POST",
    json: { captionUrl: "/uploads/captions/en.vtt", targetLanguage: "zh-HK" },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.language, "zh");
  assert.equal(body.cueCount, 2);
  const saved = await (await env.UPLOADS.get(body.captionUrl.slice(1))).text();
  assert.match(saved, /你好/);
  assert.match(saved, /再見/);
});

test("a caption missing from R2 fails fast", async () => {
  const { call } = await setup();
  router(() => "");
  const response = await call("/api/cms/translate-video-captions", { method: "POST", json: { captionUrl: "/uploads/captions/gone.vtt" } });
  assert.equal(response.status, 500);
  assert.match((await response.json()).message, /404/);
});

test("exercise JSON exports and imports back", async () => {
  const { call } = await setup();
  const exported = await (
    await call("/api/cms/export-exercises-json", { method: "POST", json: { exercises: draft.exercises, section: { title: "Animals" } } })
  ).json();
  assert.equal(exported.ok, true);
  const imported = await call("/api/cms/import-exercises-json", { method: "POST", json: exported.payload });
  const body = await imported.json();
  assert.equal(imported.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal((await call("/api/cms/import-exercises-json", { method: "POST", json: { nope: true } })).status, 400);
});

test("AI routes need a teacher login", async () => {
  const { env } = await setup();
  globalThis.fetch = async () => new Response("no", { status: 401 });
  const response = await api(handleStoreApi, env, "bad")("/api/cms/assistant", {
    method: "POST",
    headers: { "x-teacher-id": "5" },
    json: { message: "hi" },
  });
  assert.equal(response.status, 401);
});
