import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANALYSIS_BANKS, MAX_SPOKEN_LINES, isLessonId, lessonWarnings, spokenLines, validateLessonScript } from "../lib/autoclass-script.mjs";

const animalHomes = JSON.parse(readFileSync(new URL("../autoclass-video/lessons/animal-homes.json", import.meta.url), "utf8"));
const copy = () => structuredClone(animalHomes);
const paths = (result) => result.errors.map((e) => e.path);

test("the animal-homes lesson is a valid script", () => {
  const result = validateLessonScript(animalHomes);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.script.id, "animal-homes");
  assert.deepEqual(result.script.scenes.map((s) => s.kind), ["teach", "speak", "quiz", "poll", "teach", "quiz", "spell"]);
});

test("defaults are filled in: banks, tutor lines, outline, voice, timings", () => {
  const { script } = validateLessonScript(animalHomes);
  assert.deepEqual(Object.keys(script.analysis).sort(), [...ANALYSIS_BANKS].sort());
  assert.deepEqual(Object.keys(script.speakAnalysis).sort(), [...ANALYSIS_BANKS].sort());
  assert.ok(script.tutor.leadIns.length && script.tutor.leadOuts.length);
  assert.match(script.tutor.outline, /A bee lives in a hive\./);
  assert.match(script.tutor.outline, /Quiz: Where does a bee live\? Answer: hive\./);
  assert.deepEqual(script.voice, { language: "en-US", speakingRate: 1 });
  assert.equal(script.tutor.sttLanguage, "yue");
  assert.equal(script.scenes[2].timeLimit, 20);
});

test("a bank given in the script replaces only that bank", () => {
  const input = copy();
  input.analysis = { allRight: ["Yes!"] };
  const { script } = validateLessonScript(input);
  assert.deepEqual(script.analysis.allRight, ["Yes!"]);
  assert.ok(script.analysis.mixed.length > 1);
});

test("unknown banks and bad lines are reported by path", () => {
  const input = copy();
  input.analysis = { allWrong: ["x"], mixed: [] };
  input.speakAnalysis = { leadIn: [42] };
  const result = validateLessonScript(input);
  assert.equal(result.ok, false);
  assert.equal(result.script, null);
  assert.deepEqual(paths(result), ["analysis.allWrong", "analysis.mixed", "speakAnalysis.leadIn[0]"]);
});

test("quiz checks: correct in range, distinct options, wrongLines keyed by a wrong option", () => {
  const input = copy();
  input.scenes[2].correct = 4;
  input.scenes[5].options = ["frog", "frog"];
  input.scenes[5].wrongLines = { rabbit: ["no"], owl: ["no"] };
  const result = validateLessonScript(input);
  assert.deepEqual(paths(result), [
    "scenes[2].correct",
    "scenes[5].options",
    "scenes[5].correct",
    "scenes[5].wrongLines.rabbit",
    "scenes[5].wrongLines.owl",
  ]);
});

test("the right answer cannot have a wrong-answer line", () => {
  const input = copy();
  input.scenes[2].wrongLines = { hive: ["That is right!"] };
  assert.deepEqual(paths(validateLessonScript(input)), ["scenes[2].wrongLines.hive"]);
});

test("required fields, kinds and ids", () => {
  assert.deepEqual(paths(validateLessonScript(null)), [""]);
  const input = copy();
  input.id = "Animal Homes";
  delete input.title;
  input.scenes[0].kind = "lecture";
  delete input.scenes[1].ask;
  input.outro.rows[0] = ["🐦", "bird", "nest"];
  const result = validateLessonScript(input);
  assert.deepEqual(paths(result), ["id", "title", "outro.rows[0]", "scenes[0].kind", "scenes[1].ask"]);
});

test("a lesson needs a scene that is not a poll, and not too many scenes", () => {
  const polls = copy();
  polls.scenes = [polls.scenes[3]];
  assert.deepEqual(paths(validateLessonScript(polls)), ["scenes"]);
  const none = copy();
  none.scenes = [];
  assert.deepEqual(paths(validateLessonScript(none)), ["scenes"]);
  const many = copy();
  many.scenes = Array.from({ length: 21 }, () => many.scenes[0]);
  assert.deepEqual(paths(validateLessonScript(many)), ["scenes"]);
});

test("an ask scene: an open question marked against its answer", () => {
  const input = copy();
  const ask = { kind: "ask", q: "What do you do first?", answer: "Stop and check with a number you know.", ask: "Your turn! What do you do first?", reveal: "Stop, and check first!" };
  input.scenes.push(ask);
  const result = validateLessonScript(input);
  assert.deepEqual(result.errors, []);
  const scene = result.script.scenes.at(-1);
  assert.deepEqual(scene, { ...ask, emoji: "", seconds: 30 });
  assert.ok(spokenLines(result.script).includes(ask.reveal));
  assert.match(result.script.tutor.outline, /Question: What do you do first\? Answer: Stop and check/);

  input.scenes[input.scenes.length - 1] = { kind: "ask", q: "Why?", seconds: 5 };
  const bad = validateLessonScript(input);
  const last = `scenes[${input.scenes.length - 1}]`;
  assert.deepEqual(paths(bad), [`${last}.answer`, `${last}.ask`, `${last}.reveal`, `${last}.seconds`]);
});

test("highlight index and ranges", () => {
  const input = copy();
  input.intro.hl = 3;
  input.scenes[0].hl = 1.5;
  input.scenes[1].seconds = 2;
  input.voice = { language: "english", speakingRate: 3 };
  assert.deepEqual(paths(validateLessonScript(input)), ["voice.language", "voice.speakingRate", "intro.hl", "scenes[0].hl", "scenes[1].seconds"]);
});

test("spoken lines are distinct and capped", () => {
  const { script } = validateLessonScript(animalHomes);
  const lines = spokenLines(script);
  assert.equal(new Set(lines).size, lines.length);
  assert.ok(lines.includes(script.intro.say[0]));
  assert.ok(lines.includes(script.scenes[2].wrongLines.nest[0]));
  assert.ok(lines.includes(script.tutor.leadIns[0]));
  const huge = copy();
  huge.analysis = Object.fromEntries(ANALYSIS_BANKS.map((bank) => [bank, Array.from({ length: 8 }, (_, i) => `${bank} ${i}`)]));
  huge.speakAnalysis = Object.fromEntries(ANALYSIS_BANKS.map((bank) => [bank, Array.from({ length: 8 }, (_, i) => `say ${bank} ${i}`)]));
  huge.scenes = Array.from({ length: 20 }, (_, n) => ({
    ...animalHomes.scenes[0],
    pairs: animalHomes.scenes[0].pairs.map((p, i) => ({ ...p, say: `${p.say} ${n}`, repeat: `${p.repeat} ${n}.${i}` })),
  }));
  const result = validateLessonScript(huge);
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, new RegExp(String(MAX_SPOKEN_LINES)));
});

test("lesson ids", () => {
  assert.equal(isLessonId("animal-homes"), true);
  assert.equal(isLessonId("a"), true);
  assert.equal(isLessonId("-x"), false);
  assert.equal(isLessonId("../x"), false);
  assert.equal(isLessonId("x".repeat(61)), false);
});

test("a section's autoclass item keeps only its lesson id through the course store", async () => {
  const { createRequire } = await import("node:module");
  const { normalizeExercise } = createRequire(import.meta.url)("../lib/cms-store.js");
  const item = normalizeExercise({ type: "autoclass", title: "Animal Homes", items: [{ lessonId: "animal-homes", extra: 1 }] }, 1);
  assert.equal(item.type, "autoclass");
  assert.deepEqual(item.items, [{ lessonId: "animal-homes" }]);
  assert.deepEqual(normalizeExercise({ type: "autoclass", items: [{ lessonId: "../x" }] }, 1).items, []);
});

test("tutor.audience is optional text", () => {
  assert.equal(validateLessonScript(copy()).script.tutor.audience, "");
  const input = copy();
  input.tutor = { ...(input.tutor || {}), audience: "older adults in Hong Kong" };
  assert.equal(validateLessonScript(input).script.tutor.audience, "older adults in Hong Kong");
  input.tutor.audience = "x".repeat(201);
  assert.deepEqual(paths(validateLessonScript(input)), ["tutor.audience"]);
});

const SPELL = {
  kind: "spell",
  ask: "Let's play a spelling race!",
  reveal: "Great spelling, everyone!",
  words: [
    { emoji: "🐦", word: "Bird", hint: "lives in a nest" },
    { emoji: "🐝", word: "bee" },
    { emoji: "🐟", word: "fish" },
  ],
};

test("a spell scene: words lower-cased, seconds defaulted, lines spoken, words in the outline", () => {
  const input = copy();
  input.scenes.push(structuredClone(SPELL));
  const result = validateLessonScript(input);
  assert.deepEqual(result.errors, []);
  const scene = result.script.scenes.at(-1);
  assert.equal(scene.kind, "spell");
  assert.equal(scene.seconds, 60);
  assert.deepEqual(scene.words.map((w) => w.word), ["bird", "bee", "fish"]);
  assert.equal(scene.words[1].hint, "");
  const lines = spokenLines(result.script);
  assert.ok(lines.includes(SPELL.ask) && lines.includes(SPELL.reveal));
  assert.match(result.script.tutor.outline, /Spelling race: bird, bee, fish\./);
});

test("spell checks: 3 to 12 words, letters only, all different, seconds in range", () => {
  const input = copy();
  input.scenes.push(
    { ...structuredClone(SPELL), words: SPELL.words.slice(0, 2) },
    { ...structuredClone(SPELL), seconds: 5, words: [{ emoji: "🍦", word: "ice cream" }, { emoji: "🐝", word: "bee" }, { emoji: "🐝", word: "Bee" }] },
  );
  const result = validateLessonScript(input);
  assert.deepEqual(paths(result), ["scenes[7].words", "scenes[8].words[0].word", "scenes[8].words", "scenes[8].seconds"]);
});

test("a quiz may have a picture and a sound clip from the shared media folder", () => {
  const input = copy();
  input.scenes[2].image = "/uploads/autoclass/_media/kai-tak.jpg";
  input.scenes[2].clip = { src: "/uploads/autoclass/_media/song_1.mp3", from: 12.5 };
  const result = validateLessonScript(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.script.scenes[2].image, "/uploads/autoclass/_media/kai-tak.jpg");
  assert.deepEqual(result.script.scenes[2].clip, { src: "/uploads/autoclass/_media/song_1.mp3", from: 12.5, seconds: 15 });
  assert.equal("image" in result.script.scenes[5], false, "no media unless asked for");
});

test("quiz media must be the right kind of file in the media folder, and a short clip", () => {
  const input = copy();
  input.scenes[2].image = "https://example.com/kai-tak.jpg";
  input.scenes[2].clip = { src: "/uploads/autoclass/_media/song.jpg", from: -1, seconds: 90 };
  input.scenes[5].image = "/uploads/autoclass/_media/song.mp3";
  input.scenes[5].clip = { src: "/uploads/autoclass/_media/../x.mp3" };
  assert.deepEqual(paths(validateLessonScript(input)), [
    "scenes[2].image",
    "scenes[2].clip.from",
    "scenes[2].clip.seconds",
    "scenes[2].clip.src",
    "scenes[5].image",
    "scenes[5].clip.src",
  ]);
});

test("a quiz may play a video (e.g. the ad) after the answer, up to a minute", () => {
  const input = copy();
  input.scenes[2].revealVideo = { src: "/uploads/autoclass/_media/remy-martin-ad.mp4", from: 2, seconds: 30 };
  const ok = validateLessonScript(input);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.script.scenes[2].revealVideo, { src: "/uploads/autoclass/_media/remy-martin-ad.mp4", from: 2, seconds: 30 });
  input.scenes[2].revealVideo = { src: "/uploads/autoclass/_media/song.mp3", seconds: 90 };
  input.scenes[5].clip = { src: "/uploads/autoclass/_media/ad.mp4" };
  assert.deepEqual(paths(validateLessonScript(input)), ["scenes[2].revealVideo.seconds", "scenes[2].revealVideo.src", "scenes[5].clip.src"]);
});

test("the hk-nostalgia lesson follows the lesson rules", () => {
  const lesson = JSON.parse(readFileSync(new URL("../autoclass-video/lessons/hk-nostalgia.json", import.meta.url), "utf8"));
  const { script } = validateLessonScript(lesson);
  assert.deepEqual(lessonWarnings(script), []);
});

test("lessonWarnings points at the rules a script breaks without blocking it", () => {
  const lesson = JSON.parse(readFileSync(new URL("../autoclass-video/lessons/hk-nostalgia.json", import.meta.url), "utf8"));
  // No warm-up first, a song quiz with no intro, a short open question and a word for children.
  lesson.scenes = lesson.scenes.filter((scene) => !scene.warmup);
  const song = lesson.scenes.find((scene) => scene.kind === "quiz" && scene.clip);
  delete song.intro;
  lesson.scenes.push({ kind: "ask", emoji: "?", q: "Q?", ask: "小朋友，講下？", answer: "a", reveal: "ok", seconds: 10 });
  const checked = validateLessonScript(lesson);
  assert.equal(checked.ok, true, "still a valid script");
  const warnings = lessonWarnings(checked.script);
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /warm-up/);
  assert.ok(warnings.some((w) => /intro/.test(w)));
  assert.ok(warnings.some((w) => /20 seconds/.test(w)));
  assert.ok(warnings.some((w) => /小朋友/.test(w)));
});
