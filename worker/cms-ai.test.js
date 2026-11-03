import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { api, developerToken, memoryD1, memoryR2, putDoc } from "./test-env.js";

const realFetch = globalThis.fetch;
const realRandom = Math.random;
test.afterEach(() => {
  globalThis.fetch = realFetch;
  Math.random = realRandom;
});

const CMS = "https://cms.test";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

async function setup(extra = {}) {
  const assets = { fetch: async () => new Response(Uint8Array.from([137, 80, 78, 71])) };
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), ASSETS: assets, CMS_API_BASE: CMS, ORIGIN: "https://classroom.lango.ai", ...extra };
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
    if (target === `${CMS}/api/router/inworld-image`) return Response.json({ image: PNG });
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

test("a path tile is drawn with a Lango character as the reference image", async () => {
  const { call } = await setup();
  const calls = router(() => "");
  const response = await call("/api/cms/section-banner/generate", { method: "POST", json: { sectionTitle: "Fruit", courseName: "Food" } });
  assert.equal(response.status, 200);
  const image = calls.filter((entry) => entry.url.endsWith("-image"));
  assert.equal(image.length, 1);
  assert.equal(image[0].url, `${CMS}/api/router/inworld-image`);
  assert.match(image[0].body.referenceImage, /^(uncle-tommy|data:image\/png;base64,)/);
  assert.match(image[0].body.prompt, /the one in the reference image/);
  assert.doesNotMatch(image[0].body.prompt, /Do NOT include any human characters/);
});

test("a question image is drawn with a Lango character as the reference image", async () => {
  const { call } = await setup();
  const calls = router(() => "");
  const response = await call("/api/cms/question-image/generate", { method: "POST", json: { prompt: "a red apple" } });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, `${CMS}/api/router/inworld-image`);
  assert.match(calls[0].body.prompt, /^a red apple /);
  assert.match(calls[0].body.prompt, /the one in the reference image/);
  assert.ok(calls[0].body.referenceImage);
});

test("images are still made, without a character, when the character router fails", async () => {
  Math.random = () => 0; // Dan
  const { call } = await setup();
  const calls = router(() => "");
  const plain = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    String(url).endsWith("/inworld-image") ? new Response(JSON.stringify({ error: "down" }), { status: 500 }) : plain(url, init);
  const response = await call("/api/cms/question-image/generate", { method: "POST", json: { prompt: "a red apple" } });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((entry) => entry.url), [`${CMS}/api/router/image`]);
  assert.equal(calls[0].body.prompt, "a red apple");
});

test("without the static assets the plain image router is used", async () => {
  Math.random = () => 0; // Dan
  const { call } = await setup({ ASSETS: undefined });
  const calls = router(() => "");
  const response = await call("/api/cms/section-banner/generate", { method: "POST", json: { sectionTitle: "Fruit" } });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((entry) => entry.url), [`${CMS}/api/router/image`]);
  assert.match(calls.at(-1).body.prompt, /Do NOT include any human characters/);
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

test("an AI revision keeps the images questions already had", async () => {
  const { call } = await setup();
  const options = (right) => [
    { text: right, isCorrect: true },
    { text: "Dog", isCorrect: false },
    { text: "Cow", isCorrect: false },
    { text: "Pig", isCorrect: false },
  ];
  const current = [
    {
      type: "mcquiz",
      title: "Animals",
      items: [
        { title: "Which animal says meow?", image: "/uploads/questions/cat.png", options: options("Cat") },
        { title: "Which animal says moo?", image: "/uploads/questions/cow.png", options: options("Cow") },
        { title: "Which animal says oink?", image: null, options: options("Pig") },
      ],
    },
  ];
  // The model drops images, rewrites question 2 and swaps it with question 1.
  router(() =>
    JSON.stringify({
      summary: "Made question 2 easier.",
      exercises: [
        {
          type: "mcquiz",
          title: "Animals",
          items: [
            { title: "What does a cow say?", options: options("Moo") },
            { title: "Which animal says meow?", options: options("Cat") },
            { title: "Which animal says oink?", options: options("Pig") },
          ],
        },
      ],
    })
  );
  const response = await call("/api/cms/revise-exercises", {
    method: "POST",
    json: { material: "Cats meow. Cows moo. Pigs oink.", revision: "Make question 2 easier.", exercises: current, autoGenerateImages: false },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(
    body.exercises[0].items.map((item) => [item.title, item.image]),
    [
      ["What does a cow say?", "/uploads/questions/cow.png"],
      ["Which animal says meow?", "/uploads/questions/cat.png"],
      ["Which animal says oink?", null],
    ]
  );
});

test("a question picture the AI decides to add is saved and returned as its URL", async () => {
  const { env, call } = await setup();
  router((body) =>
    JSON.stringify(body).includes("benefit from a simple illustration")
      ? JSON.stringify({ generations: [{ key: "0:0", generateConfidence: 0.9, imagePrompt: "A cat saying meow" }] })
      : JSON.stringify(draft)
  );
  const response = await call("/api/cms/generate-exercises", {
    method: "POST",
    json: { material: "Cats say meow. Dogs say woof.", types: { mcquiz: 1 }, countPerType: 1 },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const image = body.exercises[0].items[0].image;
  assert.equal(typeof image, "string");
  assert.match(image, /^\/uploads\/questions\/question-ai-/);
  assert.ok(await env.UPLOADS.get(image.replace(/^\/uploads\//, "uploads/")) || await env.UPLOADS.get(image.slice(1)));
});

test("auto question pictures are generated a few at a time, not one by one", async () => {
  const { call } = await setup();
  const four = {
    exercises: [
      {
        type: "mcquiz",
        title: "Zoo",
        items: ["elephant", "giraffe", "tiger", "monkey"].map((animal) => ({
          title: `What does the ${animal} do?`,
          options: [
            { text: "Eats", isCorrect: true },
            { text: "Flies", isCorrect: false },
            { text: "Swims", isCorrect: false },
            { text: "Sings", isCorrect: false },
          ],
        })),
      },
    ],
  };
  let running = 0;
  let most = 0;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    if (target === `${CMS}/api/router/text`) {
      const text = JSON.stringify(body).includes("benefit from a simple illustration")
        ? JSON.stringify({ generations: [0, 1, 2, 3].map((index) => ({ key: `0:${index}`, generateConfidence: 0.9, imagePrompt: "zoo" })) })
        : JSON.stringify(four);
      return Response.json({ text });
    }
    if (target === `${CMS}/api/router/inworld-image`) {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return Response.json({ image: PNG });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  const response = await call("/api/cms/generate-exercises", {
    method: "POST",
    json: { material: "At the zoo.", types: { mcquiz: 4 } },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.autoImageStats.generated, 4);
  assert.ok(body.exercises[0].items.every((item) => /^\/uploads\/questions\//.test(item.image)));
  assert.equal(most, 4);
});

// The model offers a picture for every question; only a picture request uses it.
function revisionRouter(reply) {
  const calls = router((body) =>
    JSON.stringify(body).includes("benefit from a simple illustration")
      ? JSON.stringify({ generations: [{ key: "0:0", generateConfidence: 0.9, imagePrompt: "A cat" }] })
      : reply
  );
  return () => calls.filter((entry) => /image$/.test(entry.url)).length;
}

test("a revision draws question pictures only when the teacher asks for them", async () => {
  const { call } = await setup();
  const imageCalls = revisionRouter(JSON.stringify({ changed: true, summary: "Done.", ...draft }));
  const revise = (revision) =>
    call("/api/cms/revise-exercises", { method: "POST", json: { material: "Cats say meow.", revision, exercises: draft.exercises } });

  const plain = await (await revise("Make question 1 harder.")).json();
  assert.equal(plain.exercises[0].items[0].image ?? null, null);
  assert.equal(imageCalls(), 0);

  const pictured = await (await revise("Add a picture to question 1.")).json();
  assert.match(pictured.exercises[0].items[0].image, /^\/uploads\/questions\//);
  assert.equal(imageCalls(), 1);
});

test("a question to the exercise assistant is answered and leaves the draft alone", async () => {
  const { call } = await setup();
  const imageCalls = revisionRouter(JSON.stringify({ changed: false, summary: "I can add, edit or translate questions." }));
  const response = await call("/api/cms/revise-exercises", {
    method: "POST",
    json: { material: "Cats say meow.", revision: "can u help me?", exercises: draft.exercises },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.revisionMode, "reply");
  assert.equal(body.summary, "I can add, edit or translate questions.");
  assert.deepEqual(body.exercises, draft.exercises);
  assert.equal(imageCalls(), 0);
});

test("empty course details are suggested from the sections, with a cover picture", async () => {
  const { env, call } = await setup();
  const calls = router(() =>
    JSON.stringify({
      description: "Students name fruit and talk about shopping at the market.",
      level: "P3",
      objectives: ["Name common fruit", "Ask how much something costs"],
    })
  );
  const response = await call("/api/cms/course-details/suggest", {
    method: "POST",
    json: {
      courseName: "Fruit Fun",
      sections: [{ title: "At the market", content: "What does Mia's mum buy?; Three apples and two mangoes" }],
      need: { description: true, level: false, objectives: true, banner: true },
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.details.description, "Students name fruit and talk about shopping at the market.");
  assert.equal(body.details.level, undefined);
  assert.deepEqual(body.details.objectives, ["Name common fruit", "Ask how much something costs"]);
  assert.match(body.details.banner, /^\/uploads\/courses\/course-ai-/);
  assert.ok(await env.UPLOADS.get(body.details.banner.slice(1)));
  assert.ok(calls.some((entry) => entry.url.endsWith("/api/router/text") && JSON.stringify(entry.body).includes("At the market")));
});

test("an untitled course gets a short name and a one-sentence description", async () => {
  const { call } = await setup();
  const calls = router(() => JSON.stringify({ name: "\"Fruit Fun at the Market\"", description: "Students name fruit.", level: "P3", objectives: ["Name fruit"] }));
  const response = await call("/api/cms/course-details/suggest", {
    method: "POST",
    json: { courseName: "", sections: [{ title: "At the market", content: "Three apples" }], need: { name: true, description: true } },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.details.name, "Fruit Fun at the Market");
  const system = JSON.stringify(calls.find((entry) => entry.url.endsWith("/api/router/text")).body);
  assert.match(system, /ONE short sentence/);
});

test("a long description from the model is cut short", async () => {
  const { call } = await setup();
  router(() => JSON.stringify({ description: "x".repeat(400) }));
  const response = await call("/api/cms/course-details/suggest", {
    method: "POST",
    json: { sections: [{ title: "A", content: "b" }], need: { description: true } },
  });
  assert.equal((await response.json()).details.description.length, 200);
});

test("course details need at least one section", async () => {
  const { call } = await setup();
  router(() => "{}");
  const response = await call("/api/cms/course-details/suggest", { method: "POST", json: { sections: [], need: { description: true } } });
  assert.equal(response.status, 400);
});
