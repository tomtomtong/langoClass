# Autoclass lesson rules

Rules for writing or generating an autoclass lesson (`autoclass-video/lessons/<id>.json`, checked by
`lib/autoclass-script.mjs`) and for changing the autoclass page or the students' join page. They come
from the older learners (60 to 80, Hong Kong) the lessons are made for: clarity, calm and a feeling
of being cheered matter more than speed or cleverness.

`lessonWarnings()` in `lib/autoclass-script.mjs` checks the ones a script can break and returns them
as `warnings` when a lesson is saved (`PUT /api/autoclass/lessons/:id`). A warning never blocks a save.

## Lesson flow

- **Start with a warm-up.** An `ask` scene with `warmup: true`: everyone says good morning and their
  name. No marks or scores; phones only say thank you; names pop up on the big screen as students
  speak; Tommy reads a few names.
- **Song and sound quizzes play first, then ask.** Give the quiz an `intro` (Tommy: "first song,
  listen to this"), then the clip, and only then the question and options. The picture is a record
  player: centred while the song plays, sliding left for the question.
- **Reveal videos** (the original ad) are big with room around them, never full frame.
- **A student's question to Tommy** is answered right away, and Tommy says the question aloud first.
  There is no "I don't get it" button.
- **Open questions** give older learners at least 20 seconds.
- **A question with no right answer** (a memory, an opinion: "which ad do you remember?") is a
  sharing question: an `ask` scene with `open: true` and no `answer`. Nobody is marked or scored;
  phones only say thank you; the results page has no donut or right/wrong count, only names popping
  up and Tommy reading a few answers by name. Only questions with a real answer are marked.
- **Multiple-choice questions** show on the phones, view only, while Tommy reads them
  (`previewAt` in the cue); the options can be tapped only once answers open.

## Results

- Two pages, like the host's quiz results: (1) the question, the answer and the donut, with Tommy
  talking about how the class did; (2) the students who got it right, full screen, with the
  right/total pill, Tommy's overall line and a thank-you to a few of them by name.
- Sounds give emotional value and scale with how the class did. Never a buzzer or a "wrong" sound.
  Applause is recorded-style (`public/assets/soundeffect/applause-*.mp3`, made with earshot), not
  synthesised noise.
- While students answer, the live strip counts answers as they come in, with a pop each time and a
  fanfare when everyone is in.

## Tommy's words

- Short, plain Cantonese (or the lesson's language), spoken to grown-ups as grown-ups: never call
  them children (小朋友).
- Never blame, never name anyone for a mistake or for staying silent.
- Banks of lines hold 3 to 5 variants per situation; more is better for a course taught over
  several weeks.

## The students' phones (join page)

- Elderly theme: targets at least 64px, one-column answers, big type, Cantonese by default.
- Nothing may sit under the "You: name" strip or run off the bottom of the screen; check every
  screen at 390px wide (join, waiting, watch, question, results, open answer, finished, ended).
- Reactions stay behind one round button, away from the screen edge and the browser's own buttons.
- Ask for the microphone once, kindly, after joining; keep the screen awake.

## The big screen

- The background is switchable (colours, or a photo that is blurred so it never competes); the
  default blur is light and there is a blur slider.
- Background music plays only while the lesson video is paused: in the waiting room from the moment
  the room opens, then silent while Tommy and the song clips play, lower while Tommy talks on a
  results page. The Music button is on the waiting-room card too, so it can be muted before class.

## Several places at once

When the same lesson runs live in several places (rooms linked by a four-digit group code;
`docs/autoclass-tutor-multiplace-plan.md`):

- **Every place's question gets answered**, first come first served, one at a time per place; the rest
  of that place's questions wait in line (3 at most).
- A place with an answer of its own plays that. A place with none picks **one other place's answer** at a
  quiet moment (random, never the same twice, at most `tutor.watchMax`, default 3), or plays nothing.
- The cards say only the student's name, never the place.
- When many ask at once they wait for a slot (`tutor.groupRate` answers a minute, default 10). One that
  waits two minutes is let go with a kind line ("not this time, ask again soon"): never blame, never
  name anyone, and the student may ask again at once.
- Linking never holds the class up: if the group cannot be reached the place carries on by itself.
