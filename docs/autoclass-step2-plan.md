# Autoclass step 2: lesson scripts in D1, renders in a container

Step 1 (PRs #21, #22) left the lesson hardcoded in `autoclass-video/build.mjs`, built on a laptop
and uploaded by hand. Step 2 makes a lesson a saved JSON script that the Worker renders in a
container and the autoclass page plays by id. AI-writing the script and a teacher editor are step 3.

```
PUT script ──> D1 documents["autoclass-lesson:<id>"] ──> POST render ──> AutoclassContainer DO
                                                                         │ voice · scenes · HyperFrames
                                                                         ▼
/autoclass.html?lesson=<id> <── GET cues API <── R2 uploads/autoclass/<id>/<renderId>/…
```

## 1. Lesson script (the JSON shape)

The `lesson` object in `build.mjs` becomes a JSON file, unchanged in shape so the animal-homes
lesson moves over as is (`autoclass-video/lessons/animal-homes.json`):

```jsonc
{
  "version": 1,
  "id": "animal-homes",            // a-z, 0-9, "-"; 1–60 chars
  "title": "Animal Homes",
  "eyebrow": "Lango English · Animal Homes",
  "voice": { "language": "en-US", "speakingRate": 1.0 },   // optional
  "intro":  { "title": ["Where","do","animals","live?"], "hl": 2, "sub": "…", "emojis": ["🐦"], "say": ["…", "…"] },
  "scenes": [
    { "kind": "teach", "title": [...], "hl": 1, "say": "…", "pairs": [{ "emoji","home","sentence","say","repeat" }] },
    { "kind": "speak", "emoji", "sentence", "ask", "again", "seconds" },
    { "kind": "quiz",  "q", "options": [2–4], "correct", "line", "ask", "reveal", "timeLimit", "wrongLines": { "<option>": ["…"] } },
    { "kind": "poll",  "q", "options": [2–4], "ask", "thanks", "seconds" }
  ],
  "outro": { "rows": [["🐦","bird","nest"]], "say": "…", "bye": "…" },
  "analysis":      { "leadIn": [...], "allRight": [...], … },   // optional: default banks if left out
  "speakAnalysis": { … },                                        // optional, same
  "tutor": { "maxAnswers": 3, "language": "en", "sttLanguage": "yue",
             "outline": "…",            // optional: built from the teach/quiz scenes if left out
             "leadIns": [...], "leadOuts": [...] }
}
```

`lib/autoclass-script.mjs` has `validateLessonScript(script) → { ok, errors: [{ path, message }], script }`
(normalised copy, defaults filled). It checks: required fields, string lengths, `hl` inside the title,
2–4 options, `correct` in range, each `wrongLines` key is a wrong option, bank names are the known
ten (`leadIn allRight mostRight mixed mostWrong noneRight noAnswers singleRight singleWrong
someSilent`), at least one scene, and a cap on total spoken lines (so one save cannot order
thousands of TTS calls). Tests in `worker/autoclass-script.test.js`.

## 2. Where it is stored

One D1 `documents` row per lesson, name `autoclass-lesson:<lessonId>` (the same table and
`readDoc`/`writeDoc` as `teacher-courses`; no migration). Kept apart from the course document
because a script with its banks is tens of KB and would bloat every course read.

```jsonc
{ "id", "teacherId", "script", "updatedAt",
  "render": { "jobId", "status", "startedAt" },          // latest job
  "published": { "renderId", "scriptHash", "at" } }      // the render the page plays
```

Only the owning teacher can change it. A new render never overwrites the one being played:
`published` moves only when a render has fully landed in R2.

## 3. How a section links to it

A new section item type `autoclass`, stored like a `video` item in `section.exercises`:

```json
{ "type": "autoclass", "title": "Animal Homes", "items": [{ "lessonId": "animal-homes" }] }
```

The Worker's course store already keeps section items as written; `lib/cms-store.js
normalizeExercise` (course import, community copies) now keeps it too instead of turning it into
an empty mcquiz. It has no score of its own (`worker/room-scores.js` gives it none); its quizzes
score as the normal `mcquiz`/`openanswer` exercises they already are. It is **not** added to `TYPE_KEYS` in
`lib/course-plan.js` yet: that list is what the AI generator may create, and generating a lesson
is step 3. The CMS/host showing the item is also step 3.

## 4. API (Worker, all behind `AUTOCLASS=1`; writes need `requireTeacher`)

| | | |
|---|---|---|
| `PUT /api/autoclass/lessons/:id` | teacher | validate + save the script; `400 { errors }` if invalid |
| `GET /api/autoclass/lessons/:id` | teacher | script, `render`, `published` |
| `POST /api/autoclass/lessons/:id/render` | teacher | start a render of the saved script → `202 { jobId, status }` |
| `POST /api/autoclass/lessons/:id/cleanup` | teacher | remove old render folders now → `{ deleted, kept, files }` |
| `GET /api/autoclass/jobs/:jobId` | teacher | `{ status, logs, error, segmentCount, segmentsDone, lessonId }` |
| `GET /api/autoclass/lessons/:id/cues` | anyone (page is gated) | the published cues JSON, `no-store` |

Statuses are the lecture-video ones: `queued → voicing → rendering → saving → completed | failed`.
Retry = POST render again (a new job id). The page needs no login, like now.

## 5. Render job

- **DO** `AutoclassContainer` (`worker/autoclass-container.js`), one per job id, the same as
  `VideoContainer`. The queue / poll / stall-resume / time-limit logic in `worker/video-job.js`
  is reused: it gets a `save` hook so the lecture job keeps saving one MP4 and the autoclass job
  saves a folder. Its own `max_instances: 2`.
- **Image**: the same `video-container/Dockerfile` (a second `containers` entry, its own DO
  binding `AUTOCLASS_VIDEO`) (it already has HyperFrames, Chrome, FFmpeg,
  emoji fonts and `tommy-talking.webm`), with the lesson builder added under
  `video-container/autoclass/`. One image to build and keep pinned; the server gets
  `/autoclass/jobs` routes next to `/jobs`. The lesson compositions were made with HyperFrames
  0.9.40 and the lectures pin 0.8.202, so the image installs 0.9.40 beside it for autoclass only.
- **Builder**: `build.mjs`'s scene code moves into `video-container/autoclass/lesson.mjs`
  (`buildLesson(dir, script, { voice, mediaUrl })`), unchanged in timing and look.
  `autoclass-video/build.mjs` becomes a thin laptop wrapper around it (for previewing), so the
  container and the laptop cannot drift.
- **Steps in the container**: voice every distinct line (Inworld `uncle_tommy`, same settings
  as now, 3 in parallel, retry ×3) → write scenes + `index.html` → `hyperframes render` →
  a manifest of `video.mp4`, every mp3, `tommy-talking.webm`, `cues.json`.
- **Voice cache**: every line Tommy has said is kept in R2 at `uploads/autoclass/_voice/<key>.mp3`,
  the key a hash of voice, model, language, speed and text (`voiceKey` in `video-container/voice.mjs`).
  The Worker gives the renderer the cache URL; it reads each line from there first and voices only
  the misses, which it lists as `_voice/<key>.mp3` for the DO to add to the cache. A re-render after
  a small edit voices only the changed lines. (Lesson ids cannot start with `_`, so the cache folder
  never meets a lesson's.)
- **Save**: the DO copies each file to R2 at `uploads/autoclass/<lessonId>/<renderId>/…`
  (cues URLs are written for that folder), then sets the lesson's `published`, then stops the
  container. A versioned folder means a re-render never breaks a class that is playing and
  needs no cache purge.
- **Clean-up** (`worker/autoclass-cleanup.js`): the published render is never removed. A render it
  replaced is kept 6 hours (`lesson.retired`), because a class that started on it still fetches
  Tommy's lines from its folder. A render never published (failed, half saved) goes once its newest
  file is 6 hours old. Only folders named like a render id are touched; the voice cache is kept. It
  runs after every publish, hourly from a cron trigger (`17 * * * *`), and on
  `POST /api/autoclass/lessons/:id/cleanup`.
- **Local check without Docker**: `wrangler dev --enable-containers=false --var
  AUTOCLASS_RENDERER_URL:http://localhost:8085 --var PUBLIC_BASE_URL:http://localhost:8792` makes the DO call the renderer run as a plain
  `node video-container/server.mjs` (localhost URLs only; unset in production). `PUBLIC_BASE_URL`
  is needed there because `wrangler dev` reports the production host, so the cache URL would point
  at production.

## 6. The page

`public/autoclass.js` already reads `?lesson=`; it fetches `/api/autoclass/lessons/<id>/cues`
instead of `/autoclass/<id>.cues.json`. The `AUTOCLASS=1` gate in `worker/autoclass-page.js`
stays and also covers the new API. `public/autoclass/animal-homes.cues.json` and
`scripts/upload-autoclass.mjs` are removed; the lesson is `autoclass-video/lessons/animal-homes.json`.

## Not in this step

AI-written scripts, the teacher editor, showing the item in CMS/host, trimming the voice cache.

## Open questions

1. Audience (`build.mjs` young learners vs `PRODUCT.md` HK elderly): affects only the default
   banks and speaking rate; the script can set both, so it does not block this step.
2. Full re-render on every edit: this plan does that (a few minutes per lesson, mostly the video
   render); the voice cache means only changed lines are voiced again.
