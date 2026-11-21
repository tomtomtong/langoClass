// A spelling race: every phone gets the same words as scrambled letter tiles and spells as many
// as it can before the time runs out. Each phone goes at its own pace; the room only marks.
// It lives on the session, like a poll, and is started by the autoclass page's spell scene.
//
//   start_spellrace { id, title, words: [{ word, emoji, hint }], seconds }
//                                   host only; 1 to 12 words, letters a–z, 2 to 10 of them.
//                                   Told to everyone as "spell_state" with the scrambled tiles;
//                                   the words themselves stay in the room until the race ends.
//   send_spell { id, index, answer } student; answer is the letters in the order tapped.
//                                   A right word scores once; a wrong one can be tried again.
//   end_spellrace {}                host only; told to everyone as "spell_state" { open: false }
//                                   with the words, and the scores are queued.
//
// After every answer the host gets "spell_progress": each student's words and points, and how
// many have spelled them all, so the page can end the race early.
import { clip, done, isHost, isStudent } from "./room-core.js";
import { exerciseKind, queueSpellScores } from "./room-scores.js";

export const SPELL_WORD = /^[a-z]{2,10}$/;
export const MAX_SPELL_WORDS = 12;
const MIN_SECONDS = 10;
const MAX_SECONDS = 180;
const DEFAULT_SECONDS = 60;
// A right word is worth 100, and up to 50 more the earlier it comes.
const WORD_POINTS = 100;
const SPEED_POINTS = 50;
// Answers sent just as the time runs out still count.
const LATE_MS = 2000;

export function startSpellRace(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can start a spelling race." } });
  const words = (Array.isArray(data.words) ? data.words : [])
    .slice(0, MAX_SPELL_WORDS)
    .map((entry) => ({
      word: clip(entry?.word, 10).toLowerCase(),
      emoji: clip(entry?.emoji, 16),
      hint: clip(entry?.hint, 60),
    }));
  if (!words.length || !words.every((entry) => SPELL_WORD.test(entry.word))) {
    return done(state, { ack: { ok: false, error: "A spelling race needs words of 2 to 10 letters a–z." } });
  }
  const asked = Number(data.seconds);
  const seconds = Number.isInteger(asked) ? Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, asked)) : DEFAULT_SECONDS;
  closeSpellRace(state, ctx.now);
  const id = clip(data.id, 64) || `spell-${ctx.now}`;
  state.session.spell = {
    id,
    // Scored as the room's exercise when that is this race, else under the race's own id (the
    // autoclass page runs a race over its "watch the video" exercise, like a poll).
    exerciseId: exerciseKind(state.session.exercise) === "spellrace" ? state.session.exercise.id : id,
    title: clip(data.title, 120) || "Spelling race",
    words: words.map((entry) => ({ ...entry, letters: scramble(entry.word, ctx.pick) })),
    seconds,
    startedAt: ctx.now,
    endsAt: ctx.now + seconds * 1000,
    open: true,
    players: {},
    misses: words.map(() => 0),
  };
  const race = state.session.spell;
  return done(state, {
    ack: { ok: true, id, endsAt: race.endsAt, msLeft: seconds * 1000 },
    broadcasts: [spellStateEvent(race, ctx.now), progressEvent(state, race)],
  });
}

export function sendSpell(state, data, ctx) {
  const race = state.session.spell;
  if (!race?.open || (data.id && data.id !== race.id) || ctx.now > race.endsAt + LATE_MS) {
    return done(null, { ack: { ok: false, error: "The spelling race has finished." } });
  }
  if (!isStudent(ctx)) return done(null, { ack: { ok: false, error: "Join the class first." } });
  const index = Number(data.index);
  if (!Number.isInteger(index) || index < 0 || index >= race.words.length) {
    return done(null, { ack: { ok: false, error: "Pick one of the words." } });
  }
  const player = race.players[ctx.playerId] || { name: nameOf(state, ctx.playerId), solved: [], points: 0, tries: 0 };
  if (player.solved.includes(index)) {
    return done(null, { ack: { ok: true, index, correct: true, solved: player.solved.length, points: player.points } });
  }
  const answer = String(data.answer || "").toLowerCase().replace(/[^a-z]/g, "");
  const correct = answer === race.words[index].word;
  player.tries += 1;
  let earned = 0;
  if (correct) {
    const left = Math.max(0, race.endsAt - ctx.now) / (race.seconds * 1000);
    earned = WORD_POINTS + Math.round(SPEED_POINTS * Math.min(1, left));
    player.solved.push(index);
    player.points += earned;
    player.lastAt = ctx.now;
  } else {
    race.misses[index] += 1;
  }
  race.players[ctx.playerId] = player;
  return done(state, {
    ack: { ok: true, index, correct, earned, solved: player.solved.length, points: player.points },
    broadcasts: [progressEvent(state, race)],
  });
}

export function endSpellRace(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can end a spelling race." } });
  const race = state.session.spell;
  if (!race) return done(null, { ack: { ok: true, players: [], words: [] } });
  const results = resultsOf(state, race);
  return done(state, { ack: { ok: true, id: race.id, ...results }, broadcasts: closeSpellRace(state, ctx.now) });
}

// Closes the race, if there is one, queues its scores and returns what to tell the room. Starting
// the next exercise calls this too, so a race never sits on top of the next question.
export function closeSpellRace(state, now) {
  const race = state.session.spell;
  if (!race) return [];
  queueSpellScores(state, now);
  delete state.session.spell;
  return [{ event: "spell_state", data: { id: race.id, open: false, words: race.words.map(({ word, emoji }) => ({ word, emoji })) } }];
}

// What a student who joins (or reloads) during a race needs to carry on where they were.
export function spellForStudent(state, playerId, now) {
  const race = state.session.spell;
  if (!race?.open) return null;
  const player = race.players[playerId];
  return { ...spellStateEvent(race, now).data, solved: player ? [...player.solved] : [], points: player?.points || 0 };
}

// Ranked by words spelled, then points (the faster speller), then name.
export function resultsOf(state, race) {
  const players = (state.session.participants || []).map((participant) => ({
    id: participant.userId,
    name: participant.displayName || "Student",
    solved: race.players[participant.userId]?.solved.length || 0,
    score: race.players[participant.userId]?.points || 0,
    tried: participant.userId in race.players,
  }));
  for (const [id, entry] of Object.entries(race.players)) {
    if (!players.some((item) => item.id === id)) {
      players.push({ id, name: entry.name || "Student", solved: entry.solved.length, score: entry.points, tried: true });
    }
  }
  players.sort((a, b) => b.solved - a.solved || b.score - a.score || String(a.name).localeCompare(String(b.name)));
  const words = race.words.map((entry, index) => ({
    word: entry.word,
    emoji: entry.emoji,
    right: Object.values(race.players).filter((player) => player.solved.includes(index)).length,
    misses: race.misses[index],
  }));
  return { players, words };
}

// The letters in a different order from the word, when the word has one.
export function scramble(word, pick = randomPick) {
  const letters = [...word];
  if (new Set(letters).size < 2) return letters;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const out = [...letters];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = pick(i + 1) % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.join("") !== word) return out;
  }
  // The picks keep giving the word back: move the first letter to the end until it differs.
  const out = [...letters];
  do out.push(out.shift());
  while (out.join("") === word);
  return out;
}

function randomPick(count) {
  return count > 0 ? Math.floor(Math.random() * count) : 0;
}

// msLeft rather than a clock time: a phone's clock can be well off the room's.
function spellStateEvent(race, now) {
  return {
    event: "spell_state",
    data: {
      id: race.id,
      open: true,
      seconds: race.seconds,
      msLeft: Math.max(0, race.endsAt - now),
      puzzles: race.words.map(({ emoji, hint, letters }) => ({ emoji, hint, letters })),
    },
  };
}

function progressEvent(state, race) {
  const { players } = resultsOf(state, race);
  const total = race.words.length;
  return {
    event: "spell_progress",
    hostOnly: true,
    data: {
      id: race.id,
      total,
      players,
      finished: players.filter((player) => player.solved === total).length,
      spelled: players.reduce((sum, player) => sum + player.solved, 0),
    },
  };
}

function nameOf(state, playerId) {
  const participant = (state.session.participants || []).find((item) => item.userId === playerId);
  return participant?.displayName || "Student";
}
