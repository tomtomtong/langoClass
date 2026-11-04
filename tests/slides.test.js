const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// public/ scripts are plain browser scripts: run them in a bare context.
function loadBrowserScript(file, extra = {}) {
  const context = { console, window: null, ...extra };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read(file), context, { filename: file });
  return context;
}

const deck = {
  type: "slides",
  title: "Greetings",
  items: [
    { title: "Hello", bullets: ["Hi", " Good morning ", ""], image: "/uploads/a.png", audioUrl: "/uploads/slides/a.mp3" },
    { title: "", bullets: [] },
    { title: "Bye", bullets: ["See you"] },
  ],
};

test("the server normalizer keeps a slide deck and drops empty slides", () => {
  const { normalizeExercise } = require("../lib/cms-store");
  const result = normalizeExercise({ ...deck, narrate: false }, 2);
  assert.equal(result.type, "slides");
  assert.equal(result.subTitle, "Slides");
  assert.equal(result.narrate, false);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    title: "Hello",
    bullets: ["Hi", "Good morning"],
    image: "/uploads/a.png",
    audioUrl: "/uploads/slides/a.mp3",
  });
});

test("the server normalizer caps slides at 30 and points at 8", () => {
  const { normalizeExercise } = require("../lib/cms-store");
  const many = Array.from({ length: 40 }, (_, i) => ({
    title: `S${i}`,
    bullets: Array.from({ length: 12 }, (_, j) => `p${j}`),
  }));
  const result = normalizeExercise({ type: "slides", title: "x", items: many }, 1);
  assert.equal(result.items.length, 30);
  assert.equal(result.items[0].bullets.length, 8);
});

test("slides are watch-only, unscored, and take about 25 seconds a slide", () => {
  const utils = loadBrowserScript("public/exercise-utils.js", { document: {}, navigator: {} });
  assert.equal(utils.isSlidesExercise(deck), true);
  assert.equal(utils.isWatchOnlyExercise(deck), true);
  assert.equal(utils.isWatchOnlyExercise({ type: "video" }), true);
  assert.equal(utils.isWatchOnlyExercise({ type: "mcquiz" }), false);
  assert.equal(utils.estimateExerciseDurationSeconds(deck), 50, "the empty slide is not counted");
  assert.equal(utils.joinPreviewLayoutForExercise(deck), "video");
});

test("slide pictures and voice clips are preloaded with the rest of the media", () => {
  const utils = loadBrowserScript("public/exercise-utils.js", { document: {}, navigator: {} });
  const urls = utils.collectExerciseMediaUrls([deck]);
  assert.ok(urls.includes("/uploads/a.png"));
  assert.ok(urls.includes("/uploads/slides/a.mp3"));
});

test("the player trims slides and skips ones with nothing on them", () => {
  const player = loadBrowserScript("public/slides-player.js", { document: {} });
  // The player runs in another realm, so compare plain JSON copies.
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const slides = plain(player.LangoSlidesPlayer.slidesOf(deck));
  assert.equal(slides.length, 2);
  assert.deepEqual(slides[0].bullets, ["Hi", "Good morning"]);
  assert.equal(slides[1].title, "Bye");
  assert.deepEqual(plain(player.LangoSlidesPlayer.slidesOf({ items: "nope" })), []);
});

test("the host list does not show points for slides", () => {
  const hostJs = read("public/host.js");
  assert.match(hostJs, /if \(type === "slides"\) return 0;/);
  assert.match(hostJs, /points \? `\$\{points\} pts` : ""/);
});
