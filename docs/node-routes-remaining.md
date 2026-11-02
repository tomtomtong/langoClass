# Routes still served by the Node origin (2026-11-02)

class.lango.ai is the `langoclass` Worker. classroom.lango.ai (Express, `server.js`)
is retired and nothing is proxied to it. A `server.js` route the Worker does not
run yet answers 503 at once; any other unmatched `/api/*` path answers 404.

Source of truth: `worker/index.js` dispatch order -> `handleModelRequest`,
`handleVideoRequest`, `serveUpload`, `handleStoreApi` (d1-api, community,
course-media, course-transfer), `handleRoomApi`, `prepareMaterialRequest`,
then `unservedApi` (503 or 404).

## Already in the Worker (no Node needed)

- Static pages and assets in `public/`
- `/uploads/*` for the folders in `worker/uploads.js` (R2 `langoclass-uploads`)
- `/api/room/:code/ws` (RoomDurableObject), Buzz In marking (`worker/ai.js`)
- `POST /api/lango/login` and `GET /api/lango/classList`, **dev account only**
- `/api/cms/courses` list/create/get/update/delete, `/sections`
- Community: `/api/cms/community/courses*`, `/api/cms/courses/:id/community/*`
- Course media: course/section banner, intro video, question image upload
- Import/export: `/api/cms/courses/export-all`, `/:id/export`, `import-one|all[/init|chunk|complete]`
- `/api/host/progress`, `/api/scores`
- `/api/session/start|roster|end`, `/api/join/lookup`

Teacher auth (`requireTeacher`) checks tokens against newcms.lango.ai directly,
not Node.

## Still on Node, by priority

### P0: blocks normal use (moved into the Worker on 2026-11-02, branch `room-session-off-node`)

Now served by `public/vendor/gsap/`, `worker/lango-api.js`, `worker/cms-context.js`
and `dashboardProgress` in `worker/d1-api.js`.

| Route | Notes |
|---|---|
| `GET /vendor/gsap/gsap.min.js`, `Flip.min.js` | Express serves `node_modules/gsap/dist`. Copy into `public/vendor/gsap/`. |
| `POST /api/lango/login` (real teachers) | Express is a thin proxy to newcms `POST /api/login` (`server.js:4068`). Easy port. |
| `GET /api/lango/classList` (real teachers) | Proxy to newcms. |
| `GET /api/lango/classStudents` | Proxy to newcms. |
| `GET /api/cms/app-context` | CMS boot data. |
| `GET /api/cms/dashboard/progress` | CMS dashboard. |

### P1: classroom during a lesson

| Route | Notes |
|---|---|
| `POST /api/llm`, `/api/tts`, `/api/stt` | Worker wraps them (`worker/models.js`) but forwards to Node `/api/*`, `/api/transcribe/audio`, `/api/cms/prefetch-question-tts`, `/api/cms/assistant`. |
| `POST /api/cms/prefetch-question-tts`, `GET /api/cms/question-tts/:key` | TTS cache on Node disk (`data/question-tts/`). Move to R2. |
| `POST /api/transcribe/audio`, `/api/transcribe/test` | Python transcribe script on Node. |
| `GET /api/network-urls` | Join URLs. Trivial in the Worker. |
| `GET /api/room-qr.svg` | QR SVG. Port with a pure-JS QR lib. |
| `POST /api/logs/login`, `/api/logs/logout` | Writes `data/app-logs.ndjson`. Could go to D1 or `console.log`. |

### P2: CMS AI authoring

`POST /api/cms/assistant`, `generate-exercises`, `revise-exercises`,
`batch-generate-exercises`, `analyze-course-material`,
`generate-course-from-plan`, `question-image/generate`,
`section-banner/generate`, `translate-video-captions`,
`import-exercises-json`, `export-exercises-json`.

Mostly OpenRouter/LLM calls plus prompt code in Node; need Worker secrets.

### P3: video and media processing

`POST /api/cms/generate-video`, `GET /api/cms/video-jobs/:id`,
`POST /api/video`, `GET /api/video/:id` (wrapped by `worker/video.js`, backend
still Node), `generate-video-captions`, `upload-video-captions`,
`GET|PUT /api/cms/video-captions`, `compress-material-video`,
`extract-material` (container preprocesses, then still proxies to Node).

Needs ffmpeg / long jobs, so the MediaContainer is the likely home.

### P4: admin

`GET|PUT /api/config`, `POST /api/config/test-{gameplay-tts,inworld,qwen,azure,openrouter}`,
`POST /api/config/clear-student-database`, `GET /api/logs`, `/api/logs/categories`,
`/api/logs/stats`, `/api/logs/debug-files`, `DELETE /api/logs`.

## Plan to drop the Node origin (decided 2026-11-02)

classroom.lango.ai is retired. Everything moves into the Worker, and `ORIGIN`
and `proxyToOrigin` go away at the end.

1. Worker secrets `OPENROUTER_API_KEY`, `INWORLD_API_KEY` are optional: without them `worker/ai.js`
   uses the keyless newcms router. Live check on 2026-11-02 (version 94bea993): STT, TTS and LLM all 200.
2. Done (deployed 2026-11-02): `/api/network-urls`, `/api/room-qr.svg` (`worker/join-links.js`);
   `/uploads/*` is R2 only. `/api/logs/login|logout` is the System Logs admin login, so it moves with step 6.
3. Done (deployed 2026-11-02): `/api/llm|tts|stt` and Buzz In STT use `worker/ai.js` providers only;
   question TTS prefetch/get in `worker/question-tts.js`, cached in R2 `question-tts/`.
   Without keys, STT, TTS and LLM go through the newcms router.
4. Done (deployed 2026-11-02, d9030cd1; live router check passed): CMS AI authoring, all 11 routes, in `worker/cms-ai.js`. It imports the
   same `lib/` code; `lib/material-image-refs.js`, `lib/webvtt.js` and `lib/path-tile-prompt.js` were
   split out of the sharp/ffmpeg files so the Worker can bundle them. Path tiles use the media
   container's `/image/path-tile`.
5. Mostly done (deployed 2026-11-02, 8aa2ebb8):
   - Video jobs (`/api/video`, `/api/cms/generate-video`, `/api/cms/video-jobs/:id`) call the newcms
     video API via `lib/video-generator.js` (`worker/video.js`).
   - Caption upload/read/save in R2 (`worker/captions.js`).
   - `extract-material` is answered in full by `worker/material.js`: pasted text, caption URLs, txt/md/vtt,
     PDF and Word (container), HEIC, pictures and scanned PDFs (vision; needs `OPENROUTER_API_KEY`),
     WAV/MP3 under 4 MB (speech recognition). `lib/material-format.js` was split out of material-extract.
   - Still blocked: captions generated from a video, video/long-audio material, PowerPoint and
     `compress-material-video` need ffmpeg (or a pptx reader) in `container/`, and rebuilding the
     container needs Docker, which this Mac does not have. These answer 501/503 at once.
6. Admin: `/api/config*` settings in D1, `/api/logs*` in D1 or Workers Logs.
7. Done (deployed 2026-11-02, 8aa2ebb8): `ORIGIN` and `proxyToOrigin` removed. Routes from steps 5 and 6
   answer 503 until they move; unknown `/api/*` paths answer 404.

Pages never call `/api/llm`, `/api/tts`, `/api/stt` or `/api/cms/video-jobs`
directly; only the Worker does.
