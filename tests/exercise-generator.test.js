const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGenerationPrompt,
  dropDuplicateQuestions,
  validateGeneratedExercises,
} = require("../lib/exercise-generator");

const mc = (title, correct, wrong = ["x", "y"]) => ({
  title,
  options: [{ text: correct, isCorrect: true }, ...wrong.map((text) => ({ text, isCorrect: false }))],
  timeLimit: 15,
});

test("same fact asked in a quiz and a lightning round is kept only once", () => {
  const { exercises, dropped } = dropDuplicateQuestions([
    { type: "fastmcquiz", items: [mc("What happens after air is compressed?", "It mixes with fuel and ignites")] },
    {
      type: "mcquiz",
      items: [
        mc("What happens after the air is compressed?", "It mixes with fuel and ignites"),
        mc("Where is the engine mounted?", "Under the wing"),
      ],
    },
  ]);
  assert.equal(dropped, 1);
  assert.equal(exercises.length, 2);
  assert.deepEqual(exercises[1].items.map((item) => item.title), ["Where is the engine mounted?"]);
});

test("similar stems with different answers are both kept", () => {
  const { dropped } = dropDuplicateQuestions([
    {
      type: "mcquiz",
      items: [mc("Which word means big?", "huge"), mc("Which word means small?", "tiny")],
    },
  ]);
  assert.equal(dropped, 0);
});

test("duplicate Chinese stems are detected and emptied exercises are removed", () => {
  const { exercises, dropped } = dropDuplicateQuestions([
    { type: "mcquiz", items: [mc("引擎係飛機嘅咩部分?", "心臟")] },
    { type: "fastmcquiz", items: [mc("引擎係飛機嘅咩部分?", "心臟")] },
  ]);
  assert.equal(dropped, 1);
  assert.equal(exercises.length, 1);
});

test("repeated buzz-in topics are collapsed but different ones stay", () => {
  const { exercises } = dropDuplicateQuestions([
    {
      type: "buzzin",
      items: [
        { topic: "Describe your favourite food.", correctAnswer: "a" },
        { topic: "Describe your favourite food", correctAnswer: "b" },
        { topic: "Talk about your weekend.", correctAnswer: "c" },
      ],
    },
  ]);
  assert.equal(exercises[0].items.length, 2);
});

test("validation reports the dropped duplicates and flags the shortfall", () => {
  const payload = {
    exercises: [
      { type: "mcquiz", items: [mc("What is the capital of Japan?", "Tokyo")] },
      { type: "mcquiz", items: [mc("What is the capital of Japan?", "Tokyo")] },
    ],
  };
  const result = validateGeneratedExercises(payload, { mcquiz: 2 });
  assert.equal(result.duplicatesDropped, 1);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["mcquiz: got 1, need 2"]);
});

test("generation prompt asks for focus targets and bans trivia and cross-type repeats", () => {
  const [system] = buildGenerationPrompt({
    material: "Jet engines compress air.",
    langCode: "en",
    difficulty: "medium",
    typeCounts: { mcquiz: 2, fastmcquiz: 1 },
  });
  assert.match(system.content, /"focus"/);
  assert.match(system.content, /incidental details/);
  assert.match(system.content, /no two questions may test the same fact/);
  assert.match(system.content, /never write "in the text"/);
  assert.match(system.content, /test that language point itself/);
  assert.match(system.content, /mistake real learners make/);
});

const { generateExercisesFromMaterial } = require("../lib/exercise-generator");

const slideDeck = (language = "en") => ({
  exercises: [
    {
      type: "slides",
      title: "Greetings",
      items: [
        { title: language === "zh" ? "打招呼" : "Say hello", bullets: language === "zh" ? ["早晨！", "你好嗎？"] : ["Good morning!", "How are you?"], notes: language === "zh" ? "先說早晨。" : "Start with good morning." },
        { title: language === "zh" ? "說再見" : "Say goodbye", bullets: language === "zh" ? ["再見"] : ["See you later"], imageRef: "mat-1", imageRefConfidence: 0.9 },
      ],
    },
  ],
});

test("slides come back as a clean deck: bullets trimmed, notes kept, picture ref carried", async () => {
  const replies = [JSON.stringify(slideDeck())];
  const result = await generateExercisesFromMaterial(
    { material: "Greetings lesson", langCode: "en", types: { slides: 2 }, apiKey: "k" },
    async () => replies.shift()
  );
  assert.equal(result.exercises.length, 1);
  assert.equal(result.exercises[0].type, "slides");
  assert.equal(result.exercises[0].subTitle, "Slides");
  const [first, second] = result.exercises[0].items;
  assert.deepEqual(first.bullets, ["Good morning!", "How are you?"]);
  assert.equal(first.notes, "Start with good morning.");
  assert.equal(second.imageRef, "mat-1");
  assert.equal(result.stats.itemCounts.slides, 2);
  assert.equal(result.stats.partial, false);
});

test("slides written in the wrong language are sent back for a rewrite", async () => {
  const replies = [JSON.stringify(slideDeck("en")), JSON.stringify(slideDeck("zh"))];
  const calls = [];
  const result = await generateExercisesFromMaterial(
    { material: "問候語", langCode: "zh", types: { slides: 2 }, apiKey: "k" },
    async (_key, _model, messages) => {
      calls.push(messages);
      return replies.shift();
    }
  );
  assert.equal(calls.length, 2, "the English deck triggers one correction round");
  assert.match(calls[1].at(-1).content, /slides item/);
  assert.equal(result.exercises[0].items[0].title, "打招呼");
});

test("slides are not treated as repeated questions, even with the same title", () => {
  const { exercises, dropped } = dropDuplicateQuestions([
    {
      type: "slides",
      items: [
        { title: "Practice", bullets: ["a"] },
        { title: "Practice", bullets: ["b"] },
      ],
    },
  ]);
  assert.equal(dropped, 0);
  assert.equal(exercises[0].items.length, 2);
});

test("an empty slide is dropped and the shortfall is reported", () => {
  const result = validateGeneratedExercises(
    { exercises: [{ type: "slides", title: "x", items: [{ title: "Only one", bullets: ["a"] }, { title: "", bullets: [] }] }] },
    { slides: 2 }
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["slides: got 1, need 2"]);
});

test("the generation prompt asks for teaching slides, not questions", () => {
  const [system, user] = buildGenerationPrompt({
    material: "x",
    langCode: "en",
    difficulty: "medium",
    typeCounts: { slides: 5, mcquiz: 2 },
  });
  assert.match(user.content, /5 teaching slides/);
  assert.match(system.content, /slides items: \{title, bullets/);
  assert.match(user.content, /slides → "Slides"/);
});
