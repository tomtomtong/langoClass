// Laptop preview of an autoclass lesson. Lessons are rendered by the video container now
// (docs/autoclass-step2-plan.md: save the script with PUT /api/autoclass/lessons/<id>, then
// POST .../render); this only writes the same HyperFrames project here so you can look at it:
//
//   node build.mjs [lessons/<id>.json]     then   npm run dev   (or npm run check)
//
// The scenes come from ../video-container/autoclass/lesson.mjs, the same code the container runs,
// and the script is checked with ../lib/autoclass-script.mjs, as the Worker does before saving.
// Tommy's lines are voiced with the router's Inworld TTS and cached in assets/voice/ by text.
// Quiz pictures and sound clips (/uploads/autoclass/_media/<name>) are read from media/<name> here
// (not in git: upload the same files with PUT /api/autoclass/media/<name> for the real render).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { validateLessonScript } from "../lib/autoclass-script.mjs";
import { buildLesson } from "../video-container/autoclass/lesson.mjs";
import { speak } from "../video-container/voice.mjs";

const ROUTER = (process.env.ROUTER_BASE || "https://newcms.lango.ai/api/router").replace(/\/$/, "");
const file = process.argv[2] || "lessons/animal-homes.json";

const checked = validateLessonScript(JSON.parse(readFileSync(file, "utf8")));
if (!checked.ok) {
  for (const e of checked.errors) console.error(`${e.path || "(script)"}: ${e.message}`);
  process.exit(1);
}
const lesson = checked.script;
const { language, speakingRate } = lesson.voice;

async function voice(text) {
  const key = createHash("sha1").update(`${language}|${speakingRate}|${text}`).digest("hex").slice(0, 12);
  const path = `assets/voice/${key}.mp3`;
  if (!existsSync(path)) {
    writeFileSync(path, await speak(ROUTER, text, language, speakingRate));
    console.log(`voiced: ${text}`);
  }
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString().trim());
  return { file: path, seconds };
}

function media(url) {
  const name = url.split("/").pop();
  if (!existsSync(`media/${name}`)) throw new Error(`The lesson uses ${url}: put the file at autoclass-video/media/${name}.`);
  mkdirSync("assets/media", { recursive: true });
  copyFileSync(`media/${name}`, `assets/media/${name}`);
  return `assets/media/${name}`;
}

mkdirSync("assets/voice", { recursive: true });
const built = await buildLesson(".", lesson, { voice, mediaUrl: `/uploads/autoclass/${lesson.id}/local`, media });
console.log(`total ${built.total}s`);
for (const s of built.scenes) console.log(`  ${s.id.padEnd(7)} ${String(s.start).padStart(7)}  +${s.duration}${s.pauseAt ? `   pause at ${s.pauseAt}` : ""}`);
console.log(`  tutor breaks: ${built.cues.tutor.breaks.join(", ")}`);
for (const c of built.cues.cues.filter((c) => c.poll)) console.log(`  ${c.poll.id}  ${c.at}  (page only; the video does not change)`);
