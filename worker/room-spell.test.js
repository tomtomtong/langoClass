import assert from "node:assert/strict";
import test from "node:test";
import { createRoomState } from "./room-state.js";
import { applyRoomEvent } from "./room-events.js";
import { scramble } from "./room-spell.js";

const host = { socketId: "host-1", role: "host", now: 10_000, pick: () => 0 };
const at = (ctx, now) => ({ ...ctx, now });
const ada = { socketId: "s-1", role: "session_player", playerId: "ada", now: 10_000, pick: () => 0 };
const bo = { socketId: "s-2", role: "session_player", playerId: "bo", now: 10_000, pick: () => 0 };
const RACE = {
  id: "r1",
  title: "Animal homes · Spelling race",
  seconds: 60,
  words: [
    { word: "Bird", emoji: "🐦", hint: "lives in a nest" },
    { word: "bee", emoji: "🐝" },
    { word: "fish", emoji: "🐟" },
  ],
};

function room() {
  const state = createRoomState({ roomId: "123456", teacherId: 835, classItem: { id: 62, name: "5A" }, now: 1000 });
  state.session.participants = [
    { userId: "ada", displayName: "Ada", online: true, joinedAt: 1 },
    { userId: "bo", displayName: "Bo", online: true, joinedAt: 1 },
  ];
  state.session.exercise = { id: "autoclass-animal-homes-spell1", type: "spellrace", title: "Spelling race" };
  return state;
}

function started() {
  return applyRoomEvent(room(), { event: "start_spellrace", data: RACE }, host).state;
}

function spell(state, ctx, index, answer) {
  const out = applyRoomEvent(state, { event: "send_spell", data: { id: "r1", index, answer } }, ctx);
  return { ...out, state: out.state || state };
}

test("scramble gives the letters in another order, and leaves one-letter words alone", () => {
  for (const word of ["bird", "bee", "ab", "hive"]) {
    for (let seed = 0; seed < 5; seed += 1) {
      const letters = scramble(word, (n) => (seed * 7) % n);
      assert.notEqual(letters.join(""), word);
      assert.deepEqual([...letters].sort(), [...word].sort());
    }
  }
  assert.deepEqual(scramble("aa", () => 0), ["a", "a"]);
});

test("the host starts a race: phones get tiles, never the words", () => {
  const out = applyRoomEvent(room(), { event: "start_spellrace", data: RACE }, host);
  assert.deepEqual(out.ack, { ok: true, id: "r1", endsAt: 70_000, msLeft: 60_000 });
  const [stateEvent, progress] = out.broadcasts;
  assert.equal(stateEvent.event, "spell_state");
  assert.equal(stateEvent.hostOnly, undefined);
  assert.equal(stateEvent.data.open, true);
  assert.equal(stateEvent.data.msLeft, 60_000);
  assert.equal(stateEvent.data.puzzles.length, 3);
  assert.deepEqual(stateEvent.data.puzzles[0].emoji, "🐦");
  assert.ok(!JSON.stringify(stateEvent).includes('"bird"'), "the word is not sent");
  assert.deepEqual([...stateEvent.data.puzzles[0].letters].sort(), ["b", "d", "i", "r"]);
  assert.equal(progress.event, "spell_progress");
  assert.equal(progress.hostOnly, true);
  assert.deepEqual(progress.data.players.map((p) => p.solved), [0, 0]);
});

test("only the host starts or ends a race, and the words must be plain letters", () => {
  assert.equal(applyRoomEvent(room(), { event: "start_spellrace", data: RACE }, ada).ack.ok, false);
  const bad = { ...RACE, words: [{ word: "ice cream", emoji: "🍦" }] };
  assert.equal(applyRoomEvent(room(), { event: "start_spellrace", data: bad }, host).ack.ok, false);
  assert.equal(applyRoomEvent(room(), { event: "start_spellrace", data: { ...RACE, words: [] } }, host).ack.ok, false);
  assert.equal(applyRoomEvent(started(), { event: "end_spellrace", data: {} }, ada).ack.ok, false);
});

test("a right word scores once, sooner scores more, a wrong one can be tried again", () => {
  let state = started();
  const wrong = spell(state, ada, 0, "bidr");
  assert.deepEqual(wrong.ack, { ok: true, index: 0, correct: false, earned: 0, solved: 0, points: 0 });
  state = wrong.state;

  const right = spell(state, at(ada, 10_000), 0, "BIRD");
  assert.equal(right.ack.correct, true);
  assert.equal(right.ack.earned, 150, "straight away: 100 + all 50 speed points");
  state = right.state;

  const again = spell(state, ada, 0, "bird");
  assert.equal(again.ack.points, 150, "a word already spelled does not score twice");
  assert.equal(again.broadcasts.length, 0);

  const half = spell(state, at(bo, 40_000), 0, "bird");
  assert.equal(half.ack.earned, 125, "half the time gone: 100 + 25");
  state = half.state;

  assert.deepEqual(state.session.spell.misses, [1, 0, 0]);
});

test("the host sees progress and how many have spelled every word", () => {
  let state = started();
  for (const [index, word] of [[0, "bird"], [1, "bee"], [2, "fish"]]) state = spell(state, ada, index, word).state;
  const last = spell(state, bo, 1, "bee");
  const progress = last.broadcasts[0];
  assert.equal(progress.event, "spell_progress");
  assert.deepEqual(progress.data.players.map((p) => [p.name, p.solved]), [["Ada", 3], ["Bo", 1]]);
  assert.equal(progress.data.finished, 1);
  assert.equal(progress.data.spelled, 4);
  assert.equal(progress.data.total, 3);
});

test("answers stop counting after the time (with a moment's grace)", () => {
  const state = started();
  assert.equal(spell(state, at(ada, 71_500), 1, "bee").ack.ok, true, "just late still counts");
  assert.equal(spell(state, at(ada, 73_000), 2, "fish").ack.ok, false);
  assert.equal(applyRoomEvent(state, { event: "send_spell", data: { id: "other", index: 0, answer: "bird" } }, ada).ack.ok, false);
  assert.equal(spell(state, ada, 9, "bird").ack.ok, false);
});

test("ending the race reveals the words, ranks the class and queues the scores once", () => {
  let state = started();
  state = spell(state, ada, 0, "bird").state;
  state = spell(state, ada, 1, "bee").state;
  state = spell(state, bo, 1, "bea").state;
  state = spell(state, bo, 1, "bee").state;

  const ended = applyRoomEvent(state, { event: "end_spellrace", data: {} }, host);
  assert.deepEqual(ended.ack.players.map((p) => [p.name, p.solved]), [["Ada", 2], ["Bo", 1]]);
  assert.deepEqual(ended.ack.words.map((w) => [w.word, w.right, w.misses]), [["bird", 1, 0], ["bee", 2, 1], ["fish", 0, 0]]);
  assert.deepEqual(ended.broadcasts[0], {
    event: "spell_state",
    data: { id: "r1", open: false, words: [{ word: "bird", emoji: "🐦" }, { word: "bee", emoji: "🐝" }, { word: "fish", emoji: "🐟" }] },
  });
  state = ended.state;
  assert.equal(state.session.spell, undefined);
  assert.equal(state.pendingScores.length, 1);
  const batch = state.pendingScores[0];
  assert.equal(batch.exerciseId, "autoclass-animal-homes-spell1");
  assert.equal(batch.exerciseType, "spellrace");
  assert.deepEqual(batch.scores.map((s) => [s.studentUserId, s.score]), [["ada", 300], ["bo", 150]]);

  const next = applyRoomEvent(state, { event: "start_next_exercise", data: { exercise: { id: "x", type: "video" } } }, host);
  assert.equal(next.state.pendingScores.length, 1, "nothing queued twice");
});

test("a race run over another exercise (the autoclass watch video) is scored under its own id", () => {
  const state = room();
  state.session.exercise = { id: "autoclass-watch-animal-homes", type: "video", title: "Watch" };
  let raced = applyRoomEvent(state, { event: "start_spellrace", data: RACE }, host).state;
  raced = spell(raced, ada, 0, "bird").state;
  const ended = applyRoomEvent(raced, { event: "end_spellrace", data: {} }, host);
  const [batch] = ended.state.pendingScores;
  assert.equal(batch.exerciseId, "r1");
  assert.equal(batch.exerciseType, "spellrace");
  assert.equal(batch.exerciseTitle, RACE.title);
  assert.deepEqual(ended.ack.players.map((p) => [p.name, p.tried]), [["Ada", true], ["Bo", false]]);
});

test("starting the next exercise closes an open race and saves what was earned", () => {
  const state = spell(started(), ada, 0, "bird").state;
  const next = applyRoomEvent(state, { event: "start_next_exercise", data: { exercise: { id: "x", type: "video" } } }, host);
  assert.ok(next.broadcasts.some((b) => b.event === "spell_state" && b.data.open === false));
  assert.equal(next.state.session.spell, undefined);
  assert.deepEqual(next.state.pendingScores.map((b) => b.exerciseType), ["spellrace"]);
});

test("a practice race saves nothing", () => {
  const state = room();
  state.session.exercise.practice = true;
  let raced = applyRoomEvent(state, { event: "start_spellrace", data: RACE }, host).state;
  raced = spell(raced, ada, 0, "bird").state;
  const ended = applyRoomEvent(raced, { event: "end_spellrace", data: {} }, host);
  assert.equal((ended.state.pendingScores || []).length, 0);
});

test("a student who rejoins mid-race gets the tiles and the words already spelled", () => {
  const state = spell(started(), ada, 1, "bee").state;
  const rejoined = applyRoomEvent(state, { event: "join_session", data: { userId: "ada", displayName: "Ada" } }, { ...ada, socketId: "s-9" });
  assert.equal(rejoined.ack.ok, true);
  assert.deepEqual(rejoined.ack.spell.solved, [1]);
  assert.equal(rejoined.ack.spell.points, 150);
  assert.equal(rejoined.ack.spell.puzzles.length, 3);
  const later = applyRoomEvent(state, { event: "join_session", data: { userId: "ada", displayName: "Ada" } }, { ...ada, socketId: "s-9", now: 50_000 });
  assert.equal(later.ack.spell.msLeft, 20_000, "the time left, not a clock time");
});

test("end_room_exercise during a race closes it and uses its leaderboard", () => {
  const state = spell(started(), bo, 2, "fish").state;
  const ended = applyRoomEvent(state, { event: "end_room_exercise", data: {} }, host);
  assert.deepEqual(ended.ack.exerciseLeaderboard.map((p) => [p.name, p.score]), [["Bo", 150], ["Ada", 0]]);
  assert.equal(ended.state.session.spell, undefined);
  assert.ok(ended.broadcasts.some((b) => b.event === "spell_state" && b.data.open === false));
  assert.equal(ended.state.pendingScores.length, 1);
});
