# Autoclass: spelling race (串字 game) — plan

New scene kind `spell`. Tommy shows the words, then every phone races through the list:
an emoji + scrambled letter tiles, tap the letters in order. Most words spelled right in the
time wins. Scores like a quiz (points + leaderboard).

## Script (lib/autoclass-script.mjs)

```json
{
  "kind": "spell",
  "ask": "Let's play a spelling race! Spell as many as you can!",
  "reveal": "Great spelling, everyone!",
  "seconds": 60,
  "words": [
    { "emoji": "🐦", "word": "bird", "hint": "lives in a nest" },
    { "emoji": "🐝", "word": "bee" }
  ]
}
```

- `words`: 3–12, `word` letters only (a–z, max 10), `hint` optional.
- `seconds`: 20–120, default 60. Add to `SCENE_KINDS`, `spokenLines`, `defaultOutline`.

## Room (worker) — new exercise type `spellrace`

- New module `worker/room-spell.js` (like room-poll.js / room-open-answer.js):
  `start_spellrace` → sends phones the word list (scrambled server-side, word text not sent),
  `submit_spell { index, letters }` → room checks exact match, replies right/wrong,
  phone moves on. Wrong = tiles shake, retry or skip.
- Points per right word (+ small speed bonus), into room-scores.js so the leaderboard works.
- Round ends at `seconds` or when everyone finishes; host gets per-student counts.

## Phone (public/join-spell.js + css)

- Emoji + hint, blank slots, scrambled tiles; tap tile → fills next slot, tap slot → undo.
- Progress "3 / 8", timer bar, right-answer pop + sound.

## Video (video-container/autoclass/lesson.mjs)

- `spellScene`: tag "Spelling race!", grid of the emojis, Tommy says `ask`, pause cue
  `{ spell: {...}, exercise: { type: "spellrace", ... } }`, then `reveal` with every word shown.

## Autoclass page (public/autoclass.js)

- `runSpell(cue)` like runSpeak: start round, live "x words spelled" counter on screen,
  resume video when done.
- Results page: top spellers + words most missed; analysis banks reuse the quiz ones.

## Tests

- autoclass-script.test.js: validation of `spell`.
- room-spell.test.js: scramble never equals the word, marking, scoring, timeout.
- autoclass-job.test.js: cue shape.

## Order

1. Script validation + room module + tests
2. Phone UI
3. Video scene + autoclass page + results
4. Add a spell scene to animal-homes lesson and try it end to end
