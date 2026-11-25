# langoClass

- Before writing or generating an autoclass lesson, or changing the autoclass page or the students'
  join page, read `docs/autoclass-lesson-rules.md`. The rules come from the 60 to 80 year old
  learners the lessons are for; `lessonWarnings()` (lib/autoclass-script.mjs) checks the ones a
  script can break.
- Deploys, lesson re-renders and merges are done only on the user's explicit yes. Wait at least
  4 minutes after `npx wrangler deploy` before starting a render (the container restarts).
