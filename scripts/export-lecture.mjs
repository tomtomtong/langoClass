// Packs a HyperFrames lecture project (Uncle toomy vrm/lango-*) into one lecture.json
// plus its media, for public/lecture-player.js to play live in the browser.
// No timings are baked in: the player reads them from the ElevenLabs alignment and the mp3s.
// usage: node scripts/export-lecture.mjs <hyperframesProjectDir> [outDir]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const proj = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(path.join(proj, "scenes.mjs"))) {
  console.error("usage: node scripts/export-lecture.mjs <hyperframesProjectDir> [outDir]");
  process.exit(1);
}
const slug = path.basename(proj);
const outDir = path.resolve(process.argv[3] || path.join("public", "uploads", "lectures", slug));

const mod = await import(pathToFileURL(path.join(proj, "scenes.mjs")).href);
const { scenes, tommy = "3d", css = "", stock = {} } = mod;
const narration = JSON.parse(fs.readFileSync(path.join(proj, "narration.json"), "utf8"));
const meta = fs.existsSync(path.join(proj, "meta.json"))
  ? JSON.parse(fs.readFileSync(path.join(proj, "meta.json"), "utf8"))
  : {};
if (Object.keys(stock).length) console.warn("stock clips are not supported by the player yet; skipping them");

fs.mkdirSync(path.join(outDir, "voice"), { recursive: true });
const copy = (from, to) => {
  fs.copyFileSync(path.join(proj, from), path.join(outDir, to));
  return to;
};

const tommySrc = (id) => (tommy === "gif" ? "assets/tommy-talking.webm" : `assets/tommy/${id}.webm`);
if (tommy !== "gif") fs.mkdirSync(path.join(outDir, "tommy"), { recursive: true });

const lecture = {
  version: 1,
  id: slug,
  // scenes.mjs files open with: // Scene content for "<title>" ...
  title:
    mod.title ||
    fs.readFileSync(path.join(proj, "scenes.mjs"), "utf8").match(/^\/\/[^"\n]*"([^"\n]+)"/)?.[1] ||
    meta.name ||
    slug,
  width: 1920,
  height: 1080,
  logo: fs.existsSync(path.join(proj, "assets/lango-logo.png")) ? copy("assets/lango-logo.png", "lango-logo.png") : null,
  tommy: tommy === "gif" ? copy(tommySrc(), "tommy-talking.webm") : null,
  css,
  scenes: scenes.map((s) => {
    const text = narration[s.id];
    if (typeof text !== "string") throw new Error(`no narration for scene ${s.id}`);
    const alignment = JSON.parse(fs.readFileSync(path.join(proj, "assets/voice", `${s.id}.align.json`), "utf8"));
    return {
      id: s.id,
      layout: s.layout || "B",
      ...(s.lead != null && { lead: s.lead }),
      ...(s.tail != null && { tail: s.tail }),
      ...(s.title && { title: s.title }),
      html: s.html,
      reveals: s.reveals || [],
      narration: text,
      voice: copy(`assets/voice/${s.id}.mp3`, `voice/${s.id}.mp3`),
      alignment: {
        characters: alignment.characters,
        character_start_times_seconds: alignment.character_start_times_seconds,
        character_end_times_seconds: alignment.character_end_times_seconds,
      },
      ...(tommy !== "gif" && { tommy: copy(tommySrc(s.id), `tommy/${s.id}.webm`) }),
    };
  }),
};

fs.writeFileSync(path.join(outDir, "lecture.json"), JSON.stringify(lecture));
console.log(`wrote ${path.relative(process.cwd(), path.join(outDir, "lecture.json"))} (${lecture.scenes.length} scenes)`);
