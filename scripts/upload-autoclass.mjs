// Puts the autoclass media (autoclass-video/out/, written by autoclass-video/build.mjs) into R2,
// where the Worker serves it at /uploads/autoclass/... (worker/uploads.js). The media is not kept
// in git; only public/autoclass/<lesson>.cues.json is, and its URLs point here.
//
//   node scripts/upload-autoclass.mjs --local    the bucket `wrangler dev --local` uses
//   node scripts/upload-autoclass.mjs --remote   the real langoclass-uploads bucket
//
// Add --dry-run to list what would be uploaded.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "autoclass-video", "out");
const BUCKET = "langoclass-uploads";
const PREFIX = "uploads/autoclass";
const TYPES = { mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg" };

const args = new Set(process.argv.slice(2));
const target = args.has("--remote") ? "--remote" : args.has("--local") ? "--local" : "";
if (!target) {
  console.error("Say where to upload: --local or --remote.");
  process.exit(1);
}

function filesIn(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

const files = filesIn(OUT).filter((path) => TYPES[path.split(".").pop().toLowerCase()]);
if (!files.length) {
  console.error(`Nothing to upload in ${OUT}. Run autoclass-video/build.mjs first.`);
  process.exit(1);
}

for (const [i, path] of files.entries()) {
  const key = `${PREFIX}/${relative(OUT, path).split(sep).join("/")}`;
  const type = TYPES[path.split(".").pop().toLowerCase()];
  console.log(`[${i + 1}/${files.length}] ${key}`);
  if (args.has("--dry-run")) continue;
  execFileSync(
    "npx",
    ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", path, "--content-type", type, target],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] }
  );
}
console.log(`${files.length} files ${args.has("--dry-run") ? "would go" : "are"} in ${BUCKET} (${target.slice(2)}).`);
