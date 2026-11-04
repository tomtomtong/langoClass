const { test } = require("node:test");
const assert = require("node:assert/strict");
const plan = require("../lib/course-plan");

const vocabList = ["apple", "banana", "cat", "dog", "egg", "fish", "goat"].map((w) => `${w} - word`).join("\n");
const dialogue = "A: Hi, how are you?\nB: I'm fine, thanks.\nA: Where are you going?\nB: To school.\nA: See you!";
const grammar = "Grammar: neither ... nor joins two negative ideas. Spelling tip: neither starts with nei.";
const passage = "The jet engine pulls in air and squeezes it. ".repeat(20);

test("content kind is guessed from how the material looks", () => {
  assert.equal(plan.classifySectionKind(vocabList), "vocab");
  assert.equal(plan.classifySectionKind(dialogue), "dialogue");
  assert.equal(plan.classifySectionKind(grammar), "grammar");
  assert.equal(plan.classifySectionKind(passage), "reading");
});

test("question count follows material length and stays within 3-8", () => {
  const total = (types) => Object.values(types).reduce((sum, n) => sum + n, 0);
  assert.equal(total(plan.suggestSectionTypes("reading", 50)), 3);
  assert.equal(total(plan.suggestSectionTypes("reading", 650)), 5);
  assert.equal(total(plan.suggestSectionTypes("vocab", 12000)), 8);
});

test("each kind gets a different mix and none suggests video", () => {
  assert.deepEqual(plan.suggestSectionTypes("vocab", 650), { mcquiz: 3, fastmcquiz: 2 });
  assert.deepEqual(plan.suggestSectionTypes("grammar", 650), { mcquiz: 3, fastmcquiz: 2 });
  assert.deepEqual(plan.suggestSectionTypes("dialogue", 650), { mcquiz: 2, buzzin: 3 });
  assert.deepEqual(plan.suggestSectionTypes("reading", 650), { mcquiz: 4, buzzin: 1 });
  for (const kind of plan.SECTION_KINDS) {
    assert.equal(plan.suggestSectionTypes(kind, 5000).video, undefined);
  }
});

test("heading split plan records kind and suggestion for every section", async () => {
  const material = `# Words\n${vocabList}\n\n# Talk\n${dialogue}`;
  const result = await plan.analyzeCourseMaterial({ material, template: "auto" }, null);
  assert.equal(result.formatSource, "auto");
  assert.deepEqual(result.sections.map((s) => s.kind), ["vocab", "dialogue"]);
  assert.deepEqual(result.sections[1].types, result.sections[1].suggestedTypes);
});

test("auto uses each section's own mix while a fixed template stays uniform", () => {
  const sections = [
    { title: "Words", material: vocabList },
    { title: "Talk", material: dialogue },
  ];
  const auto = plan.prepareCourseGeneration({ plan: { sections }, template: "auto" });
  assert.notDeepEqual(auto.jobs[0].types, auto.jobs[1].types);
  assert.equal(auto.jobs[1].kind, "dialogue");

  const fixed = plan.prepareCourseGeneration({
    plan: { sections },
    template: "vocab",
    types: { mcquiz: 4 },
    difficulty: "easy",
  });
  assert.deepEqual(fixed.jobs.map((job) => job.types), [{ mcquiz: 4 }, { mcquiz: 4 }]);
});

test("a teacher's per-section pick wins in auto, including video", () => {
  const { jobs } = plan.prepareCourseGeneration({
    plan: {
      sections: [
        { title: "Story", material: passage, types: { mcquiz: 2, video: 1 } },
        { title: "Words", material: vocabList },
      ],
    },
    template: "auto",
  });
  assert.deepEqual(jobs[0].llmTypes, { mcquiz: 2 });
  assert.equal(jobs[0].videoCount, 1);
  assert.equal(jobs[1].videoCount, 0);
  assert.ok(Object.keys(jobs[1].llmTypes).length);
});

test("a fixed template with no types, or an empty plan, is a 400", () => {
  const sections = [{ title: "Words", material: vocabList }];
  assert.throws(() => plan.prepareCourseGeneration({ plan: { sections }, template: "custom" }), { status: 400 });
  assert.throws(() => plan.prepareCourseGeneration({ plan: { sections: [] }, template: "auto" }), { status: 400 });
});

test("LLM-provided kind is used, an unknown one falls back to the guess", async () => {
  const llm = async () =>
    JSON.stringify({
      courseTitle: "T",
      sections: [
        { indexes: [0], title: "A", kind: "dialogue" },
        { indexes: [1], title: "B", kind: "nonsense" },
      ],
    });
  const result = await plan.analyzeCourseMaterial(
    { material: `# A\n${passage}\n\n# B\n${vocabList}`, template: "auto" },
    llm
  );
  assert.equal(result.planner, "llm");
  assert.deepEqual(result.sections.map((s) => s.kind), ["dialogue", "vocab"]);
});

test("slides can be part of a section's mix and go to the AI, never to the video queue", () => {
  const { jobs } = plan.prepareCourseGeneration({
    plan: { sections: [{ title: "Intro", material: passage, types: { slides: 5, mcquiz: 2 } }] },
    template: "auto",
  });
  assert.deepEqual(jobs[0].llmTypes, { slides: 5, mcquiz: 2 });
  assert.equal(jobs[0].videoCount, 0);
  assert.equal(plan.formatLabel({ slides: 5 }, "medium"), "5 Slides · Medium");
});

test("Auto never suggests slides: they are something a teacher chooses", () => {
  for (const kind of plan.SECTION_KINDS) {
    assert.equal(plan.suggestSectionTypes(kind, 5000).slides, undefined);
  }
});
