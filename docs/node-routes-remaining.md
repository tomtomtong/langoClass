# Routes still served by the Node origin (2026-11-02)

class.lango.ai is the `langoclass` Worker. Anything it does not handle itself is
proxied to `ORIGIN` = `https://classroom.lango.ai` (Express, `server.js`).
On 2026-11-02 that origin returned Cloudflare 522, so every route below hung.

Source of truth: `worker/index.js` dispatch order -> `handleModelRequest`,
`handleVideoRequest`, `serveUpload`, `handleStoreApi` (d1-api, community,
course-media, course-transfer), `handleRoomApi`, `prepareMaterialRequest`,
then `proxyToOrigin`.

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

## Quick unblock

Restarting the Express deploy at classroom.lango.ai brings all of the above
back immediately. Doing P0 alone lets real teachers log in and run the host
page without Node.
