import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { summarize, plan, makePicker } = createRequire(import.meta.url)("../public/autoclass-analysis.js");

// Four options, B (index 1) is right. A student is a number: the option they picked, or null.
const results = (...picks) => picks.map((answerIndex, i) => ({ playerId: `p${i}`, name: `S${i}`, answerIndex }));
const situation = (...picks) => summarize(results(...picks), 4, 1).situation;

const lines = (name, n) => Array.from({ length: n }, (_, i) => ({ text: `${name} ${i + 1}`, url: `/${name}-${i + 1}.mp3` }));
const banks = Object.fromEntries(
  ["leadIn", "noAnswers", "singleRight", "singleWrong", "allRight", "noneRight", "mostRight", "mixed", "mostWrong", "someSilent"].map((name) => [name, lines(name, 4)])
);
const wrong = { 0: lines("wrong-A", 2), 2: lines("wrong-C", 2), 3: lines("wrong-D", 2) };
const kinds = (summary, picker) => plan(summary, banks, wrong, picker || makePicker(() => 0), { questionKey: "q1" }).lines.map((l) => l.kind);

test("every situation is told apart", () => {
  assert.equal(situation(), "noAnswers", "a class of none");
  assert.equal(situation(null, null, null), "noAnswers", "everyone silent");
  assert.equal(situation(1), "singleRight");
  assert.equal(situation(2), "singleWrong");
  assert.equal(situation(1, null, null), "singleRight", "one answer among silent students");
  assert.equal(situation(1, 1, 1), "allRight");
  assert.equal(situation(1, 1, null), "allRight", "silent students do not make it less right");
  assert.equal(situation(0, 2), "noneRight");
  assert.equal(situation(0, 0, 2, 3), "noneRight");
  assert.equal(situation(1, 1, 1, 0), "mostRight", "75%");
  assert.equal(situation(1, 1, 0), "mixed", "67% is under 70%");
  assert.equal(situation(1, 0), "mixed", "half");
  assert.equal(situation(1, 1, 1, 1, 1, 1, 1, 0, 0, 0), "mostRight", "exactly 70%");
  assert.equal(situation(1, 1, 1, 0, 0, 0, 0, 0, 0, 0), "mostWrong", "30%");
  assert.equal(situation(1, 1, 1, 1, 0, 0, 0, 0, 0, 0), "mixed", "exactly 40%");
});

test("the numbers come from the picks, and odd results do not break it", () => {
  const s = summarize(results(1, 1, 2, 2, 3, null), 4, 1);
  assert.deepEqual({ total: s.total, answered: s.answered, right: s.right, silent: s.silent, counts: s.counts }, { total: 6, answered: 5, right: 2, silent: 1, counts: [0, 2, 2, 1] });
  assert.equal(s.wrongTop, 2, "a tie goes to the first option");
  assert.equal(s.wrongTopCount, 2);

  const odd = summarize([null, undefined, {}, { answerIndex: 9 }, { answerIndex: "1" }, { answerIndex: -1 }, { answerIndex: 1 }], 4, 1);
  assert.equal(odd.answered, 1);
  assert.equal(odd.situation, "singleRight");
  assert.equal(summarize(undefined, 4, 1).situation, "noAnswers");
  assert.equal(summarize(results(1), 0, 1).situation, "noAnswers", "no options at all");
});

test("a nobody-answered question skips the lead-in, and says nothing about silence or mistakes", () => {
  assert.deepEqual(kinds(summarize(results(null, null, null), 4, 1)), ["noAnswers"]);
  assert.deepEqual(kinds(summarize(results(), 4, 1)), ["noAnswers"]);
});

test("a normal question: lead-in, then the situation", () => {
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 1, 1, 1, 1, 1), 4, 1)), ["leadIn", "allRight"]);
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 1, 1, 1, 1, 1, 1, 0), 4, 1)), ["leadIn", "mostRight"], "one wrong pick is not worth a word in a big class");
});

test("the most picked wrong option is mentioned when it was not a one-off", () => {
  const two = summarize(results(1, 1, 1, 1, 1, 2, 2), 4, 1); // 5 of 7 right: 71%
  assert.deepEqual(kinds(two), ["leadIn", "mostRight", "wrong"]);
  const picked = plan(two, banks, wrong, makePicker(() => 0), { questionKey: "q1" }).lines.at(-1);
  assert.match(picked.text, /^wrong-C/);

  const spread = summarize(results(1, 1, 1, 1, 1, 1, 1, 0, 2, 3), 4, 1); // 7 of 10 right
  assert.deepEqual(kinds(spread), ["leadIn", "mostRight"], "three different single mistakes: nothing to point at");
});

test("in a very small class a single wrong pick is worth a word", () => {
  assert.deepEqual(kinds(summarize(results(2), 4, 1)), ["leadIn", "singleWrong", "wrong"]);
  assert.deepEqual(kinds(summarize(results(1, 3), 4, 1)), ["leadIn", "mixed", "wrong"]);
  assert.deepEqual(kinds(summarize(results(1, 3, 1, 1), 4, 1)), ["leadIn", "mostRight"], "four students: back to the big-class rule");
});

test("silent students are mentioned only when it matters", () => {
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 1, 1, 1, 1, 1, 1, null), 4, 1)), ["leadIn", "allRight"], "1 of 10");
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 1, 1, 1, 1, 1, null, null), 4, 1)), ["leadIn", "allRight", "someSilent"], "2 of 10");
  assert.deepEqual(kinds(summarize(results(1, 1, 1, null), 4, 1)), ["leadIn", "allRight", "someSilent"], "1 of 4 is a quarter");
  assert.deepEqual(kinds(summarize(results(1, null), 4, 1)), ["leadIn", "singleRight", "someSilent"], "1 of 2");
  assert.deepEqual(kinds(summarize(results(1), 4, 1)), ["leadIn", "singleRight"], "a class of one has no silent student");
});

test("after the situation there is one extra line at most: the wrong option, unless half the class or more was silent", () => {
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 0, 0, null, null), 4, 1)), ["leadIn", "mixed", "wrong"], "2 of 7 silent");
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 0, 0, null, null, null), 4, 1)), ["leadIn", "mixed", "wrong"], "3 of 8 silent");
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 0, 0, null, null, null, null, null), 4, 1)), ["leadIn", "mixed", "someSilent"], "exactly half silent");
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 0, 0, null, null, null, null, null, null), 4, 1)), ["leadIn", "mixed", "someSilent"], "6 of 11 silent");
  assert.deepEqual(kinds(summarize(results(1, 1, 1, 1, 1, 1, 1, 1, null, null), 4, 1)), ["leadIn", "allRight", "someSilent"], "no wrong option to teach, so the silent line stays");
});

test("a missing or empty bank is skipped instead of breaking", () => {
  const summary = summarize(results(1, 1, 0, 0), 4, 1);
  assert.deepEqual(plan(summary, {}, {}, makePicker()).lines, []);
  assert.deepEqual(plan(summary, { mixed: [] }, undefined, makePicker()).lines, []);
  assert.deepEqual(plan(summary, { mixed: lines("m", 1) }, { 0: [] }, makePicker()).lines.map((l) => l.text), ["m 1"]);
  assert.deepEqual(plan(summary, undefined, undefined, undefined).lines, []);
});

test("every line keeps its text and file for the page to play", () => {
  const [lead, main] = plan(summarize(results(1, 1, 1), 4, 1), banks, wrong, makePicker(() => 0.99)).lines;
  assert.equal(lead.kind, "leadIn");
  assert.match(lead.text, /^leadIn \d$/);
  assert.match(lead.url, /^\/leadIn-\d\.mp3$/);
  assert.equal(main.kind, "allRight");
});

test("Tommy does not repeat himself: every line is used before one comes round again", () => {
  const picker = makePicker();
  const list = lines("a", 5);
  for (let round = 0; round < 4; round += 1) {
    const seen = Array.from({ length: 5 }, () => picker.next("a", list).text);
    assert.equal(new Set(seen).size, 5, `round ${round + 1} used all five`);
  }
});

test("a new round never starts with the line just played", () => {
  for (let seed = 0; seed < 200; seed += 1) {
    let n = seed + 1;
    const random = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
    const picker = makePicker(random);
    const list = lines("a", 3);
    let previous = null;
    for (let i = 0; i < 30; i += 1) {
      const next = picker.next("a", list);
      assert.notEqual(next, previous, `seed ${seed} step ${i}`);
      previous = next;
    }
  }
});

test("each bank has its own rotation, and a single line just repeats", () => {
  const picker = makePicker();
  const a = lines("a", 2);
  const b = lines("b", 2);
  const first = picker.next("a", a);
  picker.next("b", b);
  assert.notEqual(picker.next("a", a), first);
  assert.equal(picker.next("solo", [a[0]]), a[0]);
  assert.equal(picker.next("solo", [a[0]]), a[0]);
  assert.equal(picker.next("none", []), null);
  assert.equal(picker.next("none", undefined), null);
});

test("two questions get their own wrong-answer lines", () => {
  const picker = makePicker(() => 0);
  const summary = summarize(results(1, 1, 1, 2, 2), 4, 1);
  const first = plan(summary, banks, wrong, picker, { questionKey: "q1" }).lines.at(-1);
  const second = plan(summary, banks, wrong, picker, { questionKey: "q2" }).lines.at(-1);
  assert.equal(first.text, second.text, "a new question starts its own rotation");
  const third = plan(summary, banks, wrong, picker, { questionKey: "q1" }).lines.at(-1);
  assert.notEqual(third.text, first.text, "but the same question rotates");
});
