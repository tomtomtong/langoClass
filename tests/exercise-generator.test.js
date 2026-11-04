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
});
