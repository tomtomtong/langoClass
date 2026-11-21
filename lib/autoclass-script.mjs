// The autoclass lesson script: everything Uncle Tommy says and shows in one self-running lesson
// (docs/autoclass-step2-plan.md). The Worker checks a script with validateLessonScript before it is
// saved, and the render container (video-container/autoclass/lesson.mjs) only ever gets the
// normalised copy this returns, with every default filled in.
//
// Scene kinds:
//   teach  a title and up to four pairs (emoji → word), each said, then "say it with me" (optional)
//   speak  say it with me: every phone records one sentence (encouragement only, no points)
//   ask    an open question: every phone answers out loud at once, the model marks each answer
//          against `answer` (correct, partly, not yet); no points
//   quiz   a multiple-choice question; becomes a normal mcquiz exercise, so it scores as one
//   poll   a just-for-fun vote; not a scene in the video, the page draws it between two scenes
import {
  DEFAULT_ANALYSIS,
  DEFAULT_SPEAK_ANALYSIS,
  DEFAULT_TUTOR_LEAD_INS,
  DEFAULT_TUTOR_LEAD_OUTS,
} from "./autoclass-defaults.mjs";

export const SCRIPT_VERSION = 1;
export const SCENE_KINDS = ["teach", "speak", "ask", "quiz", "poll"];
export const ANALYSIS_BANKS = [
  "leadIn",
  "allRight",
  "mostRight",
  "mixed",
  "mostWrong",
  "noneRight",
  "noAnswers",
  "singleRight",
  "singleWrong",
  "someSilent",
];
export const LESSON_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
// Every distinct spoken line is one TTS call in the render; this keeps one save from ordering
// thousands of them. The animal-homes lesson has about 110.
export const MAX_SPOKEN_LINES = 250;
const MAX_SCENES = 20;
const MAX_LINE = 600;

export function isLessonId(value) {
  return typeof value === "string" && LESSON_ID.test(value);
}

// → { ok, errors: [{ path, message }], script } (script is null unless ok).
export function validateLessonScript(input) {
  const errors = [];
  const fail = (path, message) => {
    errors.push({ path, message });
    return undefined;
  };
  const v = checkers(fail);

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: [{ path: "", message: "The script must be a JSON object." }], script: null };
  }
  const version = input.version ?? SCRIPT_VERSION;
  if (version !== SCRIPT_VERSION) fail("version", `Only version ${SCRIPT_VERSION} is supported.`);

  const id = isLessonId(input.id) ? input.id : fail("id", "Use 1–60 lowercase letters, digits or dashes, starting with a letter or digit.");
  const title = v.text("title", input.title, 120);
  const script = {
    version: SCRIPT_VERSION,
    id,
    title,
    eyebrow: input.eyebrow == null ? `Lango English · ${title || ""}`.trim() : v.text("eyebrow", input.eyebrow, 120),
    voice: voiceOf(input.voice, v, fail),
    intro: introOf(input.intro, v, fail),
    scenes: [],
    outro: outroOf(input.outro, v, fail),
  };

  if (!Array.isArray(input.scenes) || !input.scenes.length) fail("scenes", "Add at least one scene.");
  else if (input.scenes.length > MAX_SCENES) fail("scenes", `At most ${MAX_SCENES} scenes.`);
  else script.scenes = input.scenes.map((scene, i) => sceneOf(scene, `scenes[${i}]`, v, fail));
  if (script.scenes.length && script.scenes.every((scene) => scene?.kind === "poll")) {
    fail("scenes", "A lesson needs at least one scene that is not a poll.");
  }

  script.analysis = banksOf(input.analysis, "analysis", DEFAULT_ANALYSIS, v, fail);
  script.speakAnalysis = banksOf(input.speakAnalysis, "speakAnalysis", DEFAULT_SPEAK_ANALYSIS, v, fail);
  script.tutor = tutorOf(input.tutor, script, v, fail);

  if (!errors.length) {
    const lines = spokenLines(script).length;
    if (lines > MAX_SPOKEN_LINES) fail("", `Tommy has ${lines} different lines; keep it to ${MAX_SPOKEN_LINES}.`);
  }
  return errors.length ? { ok: false, errors, script: null } : { ok: true, errors: [], script };
}

// Every distinct line Tommy speaks in a (normalised) script, in the order they appear.
export function spokenLines(script) {
  const out = [];
  const add = (text) => {
    if (typeof text === "string" && text.trim()) out.push(text);
  };
  script.intro?.say?.forEach(add);
  for (const scene of script.scenes || []) {
    if (scene.kind === "teach") {
      add(scene.say);
      scene.pairs.forEach((pair) => [pair.say, pair.repeat].forEach(add));
    } else if (scene.kind === "speak") {
      [scene.ask, scene.again].forEach(add);
    } else if (scene.kind === "ask") {
      [scene.ask, scene.reveal].forEach(add);
    } else if (scene.kind === "quiz") {
      [scene.ask, scene.reveal].forEach(add);
      Object.values(scene.wrongLines || {}).flat().forEach(add);
    } else if (scene.kind === "poll") {
      [scene.ask, scene.thanks].forEach(add);
    }
  }
  add(script.outro?.say);
  for (const banks of [script.analysis, script.speakAnalysis]) Object.values(banks || {}).flat().forEach(add);
  [...(script.tutor?.leadIns || []), ...(script.tutor?.leadOuts || [])].forEach(add);
  return [...new Set(out)];
}

// The outline the raise-a-hand tutor gets when a script gives none: the lesson's own sentences.
export function defaultOutline(script) {
  return [
    `A lesson called "${script.title}".`,
    ...script.scenes.filter((s) => s.kind === "teach").flatMap((s) => s.pairs.map((p) => p.sentence)),
    ...script.scenes.filter((s) => s.kind === "quiz").map((s) => `Quiz: ${s.q} Answer: ${s.options[s.correct]}.`),
    ...script.scenes.filter((s) => s.kind === "ask").map((s) => `Question: ${s.q} Answer: ${s.answer}`),
  ].join(" ");
}

function checkers(fail) {
  const text = (path, value, max, { optional = false } = {}) => {
    if (value == null || value === "") {
      if (optional) return "";
      return fail(path, "Required.");
    }
    if (typeof value !== "string") return fail(path, "Must be text.");
    const trimmed = value.trim();
    if (!trimmed) return optional ? "" : fail(path, "Required.");
    if (trimmed.length > max) return fail(path, `At most ${max} characters.`);
    return trimmed;
  };
  const line = (path, value, opts) => text(path, value, MAX_LINE, opts);
  const list = (path, value, { min, max, item }) => {
    if (!Array.isArray(value)) return fail(path, "Must be a list.") || [];
    if (value.length < min) return fail(path, `Needs at least ${min}.`) || [];
    if (value.length > max) return fail(path, `At most ${max}.`) || [];
    return value.map((entry, i) => item(`${path}[${i}]`, entry));
  };
  const int = (path, value, { min, max, fallback }) => {
    if (value == null) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) return fail(path, `A whole number from ${min} to ${max}.`);
    return value;
  };
  const object = (path, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "Required.") || null;
    return value;
  };
  return { text, line, list, int, object };
}

function voiceOf(input, v, fail) {
  const voice = { language: "en-US", speakingRate: 1 };
  if (input == null) return voice;
  if (typeof input !== "object") return fail("voice", "Must be an object.") || voice;
  if (input.language != null) {
    if (typeof input.language === "string" && /^[a-z]{2,3}-[A-Z]{2}$/.test(input.language)) voice.language = input.language;
    else fail("voice.language", 'A language tag such as "en-US" or "yue-HK".');
  }
  if (input.speakingRate != null) {
    const rate = input.speakingRate;
    if (typeof rate === "number" && rate >= 0.7 && rate <= 1.5) voice.speakingRate = rate;
    else fail("voice.speakingRate", "A number from 0.7 to 1.5.");
  }
  return voice;
}

function introOf(input, v, fail) {
  const intro = v.object("intro", input);
  if (!intro) return null;
  const title = v.list("intro.title", intro.title, { min: 1, max: 5, item: (p, s) => v.text(p, s, 40) });
  return {
    title,
    hl: v.int("intro.hl", intro.hl, { min: -1, max: Math.max(0, title.length - 1), fallback: -1 }),
    sub: v.text("intro.sub", intro.sub, 200, { optional: true }),
    emojis: intro.emojis == null ? [] : v.list("intro.emojis", intro.emojis, { min: 0, max: 8, item: (p, s) => v.text(p, s, 16) }),
    say: v.list("intro.say", intro.say, { min: 1, max: 4, item: v.line }),
  };
}

function words(path, value, v) {
  return v.list(path, value, { min: 1, max: 12, item: (p, s) => v.text(p, s, 30) });
}

function sceneOf(input, path, v, fail) {
  const scene = v.object(path, input);
  if (!scene) return null;
  if (!SCENE_KINDS.includes(scene.kind)) return fail(`${path}.kind`, `One of: ${SCENE_KINDS.join(", ")}.`) || null;
  const at = (key) => `${path}.${key}`;

  if (scene.kind === "teach") {
    const title = words(at("title"), scene.title, v);
    return {
      kind: "teach",
      title,
      hl: v.int(at("hl"), scene.hl, { min: -1, max: Math.max(0, title.length - 1), fallback: -1 }),
      say: v.line(at("say"), scene.say),
      pairs: v.list(at("pairs"), scene.pairs, {
        min: 1,
        max: 4,
        item: (p, pair) => {
          if (!v.object(p, pair)) return null;
          return {
            emoji: v.text(`${p}.emoji`, pair.emoji, 16),
            home: v.text(`${p}.home`, pair.home, 30),
            sentence: v.text(`${p}.sentence`, pair.sentence, 120),
            say: v.line(`${p}.say`, pair.say),
            // Optional: "say it with me" for a language lesson; leave it out to only explain.
            repeat: v.line(`${p}.repeat`, pair.repeat, { optional: true }),
          };
        },
      }),
    };
  }

  if (scene.kind === "speak") {
    return {
      kind: "speak",
      emoji: v.text(at("emoji"), scene.emoji, 16, { optional: true }),
      sentence: v.text(at("sentence"), scene.sentence, 160),
      ask: v.line(at("ask"), scene.ask),
      again: v.line(at("again"), scene.again),
      seconds: v.int(at("seconds"), scene.seconds, { min: 5, max: 60, fallback: 15 }),
    };
  }

  if (scene.kind === "ask") {
    return {
      kind: "ask",
      emoji: v.text(at("emoji"), scene.emoji, 16, { optional: true }),
      q: v.text(at("q"), scene.q, 160),
      // What a good answer says: the model marks each answer against it, and the screen shows it
      // after the class has answered. It is never sent to the phones.
      answer: v.text(at("answer"), scene.answer, 300),
      ask: v.line(at("ask"), scene.ask),
      reveal: v.line(at("reveal"), scene.reveal),
      // The room keeps an open question open for at least 10 seconds (worker/room-open-answer.js).
      seconds: v.int(at("seconds"), scene.seconds, { min: 10, max: 120, fallback: 30 }),
    };
  }

  const options = v.list(at("options"), scene.options, { min: 2, max: 4, item: (p, s) => v.text(p, s, 40) });
  if (options.every(Boolean) && new Set(options).size !== options.length) fail(at("options"), "Options must all differ.");

  if (scene.kind === "poll") {
    return {
      kind: "poll",
      q: v.text(at("q"), scene.q, 160),
      options,
      ask: v.line(at("ask"), scene.ask),
      thanks: v.line(at("thanks"), scene.thanks, { optional: true }),
      seconds: v.int(at("seconds"), scene.seconds, { min: 5, max: 120, fallback: 20 }),
    };
  }

  const correct = v.int(at("correct"), scene.correct ?? -1, { min: 0, max: Math.max(0, options.length - 1) });
  const wrongLines = {};
  if (scene.wrongLines != null) {
    if (typeof scene.wrongLines !== "object" || Array.isArray(scene.wrongLines)) {
      fail(at("wrongLines"), "Must be an object keyed by a wrong option.");
    } else {
      for (const [option, lines] of Object.entries(scene.wrongLines)) {
        const index = options.indexOf(option);
        if (index < 0 || index === correct) {
          fail(`${at("wrongLines")}.${option}`, "Not one of this question's wrong options.");
          continue;
        }
        wrongLines[option] = v.list(`${at("wrongLines")}.${option}`, lines, { min: 1, max: 6, item: v.line });
      }
    }
  }
  return {
    kind: "quiz",
    q: v.text(at("q"), scene.q, 160),
    options,
    correct,
    line: v.text(at("line"), scene.line, 160),
    ask: v.line(at("ask"), scene.ask),
    reveal: v.line(at("reveal"), scene.reveal),
    timeLimit: v.int(at("timeLimit"), scene.timeLimit, { min: 5, max: 120, fallback: 20 }),
    wrongLines,
  };
}

function outroOf(input, v, fail) {
  const outro = v.object("outro", input);
  if (!outro) return null;
  return {
    // Each row is [emoji, word, link, highlighted word], e.g. ["🐦", "bird", "lives in a", "nest"].
    rows: v.list("outro.rows", outro.rows, {
      min: 1,
      max: 6,
      item: (p, row) => {
        if (!Array.isArray(row) || row.length !== 4) return fail(p, "Four parts: emoji, word, link, highlighted word.") || null;
        return [v.text(`${p}[0]`, row[0], 16), v.text(`${p}[1]`, row[1], 30), v.text(`${p}[2]`, row[2], 30, { optional: true }), v.text(`${p}[3]`, row[3], 30)];
      },
    }),
    say: v.line("outro.say", outro.say),
    bye: v.text("outro.bye", outro.bye, 80),
  };
}

function banksOf(input, path, defaults, v, fail) {
  const banks = structuredClone(defaults);
  if (input == null) return banks;
  if (typeof input !== "object" || Array.isArray(input)) return fail(path, "Must be an object of banks.") || banks;
  for (const [name, lines] of Object.entries(input)) {
    if (!ANALYSIS_BANKS.includes(name)) {
      fail(`${path}.${name}`, `Unknown bank. Use: ${ANALYSIS_BANKS.join(", ")}.`);
      continue;
    }
    banks[name] = v.list(`${path}.${name}`, lines, { min: 1, max: 8, item: v.line });
  }
  return banks;
}

function tutorOf(input, script, v, fail) {
  const tutor = input ?? {};
  if (typeof tutor !== "object" || Array.isArray(tutor)) return fail("tutor", "Must be an object.") || null;
  const lang = (key, fallback) => {
    if (tutor[key] == null) return fallback;
    if (typeof tutor[key] === "string" && /^[a-z]{2,3}$/.test(tutor[key])) return tutor[key];
    return fail(`tutor.${key}`, 'A language code such as "en", "yue" or "zh".');
  };
  const out = {
    enabled: tutor.enabled !== false,
    maxAnswers: v.int("tutor.maxAnswers", tutor.maxAnswers, { min: 0, max: 10, fallback: 3 }),
    language: lang("language", "en"),
    sttLanguage: lang("sttLanguage", "en"),
    outline: v.text("tutor.outline", tutor.outline, 4000, { optional: true }),
    leadIns: tutor.leadIns == null ? [...DEFAULT_TUTOR_LEAD_INS] : v.list("tutor.leadIns", tutor.leadIns, { min: 1, max: 6, item: v.line }),
    leadOuts: tutor.leadOuts == null ? [...DEFAULT_TUTOR_LEAD_OUTS] : v.list("tutor.leadOuts", tutor.leadOuts, { min: 1, max: 6, item: v.line }),
  };
  if (!out.outline && script.title && script.scenes.every(Boolean)) out.outline = defaultOutline(script);
  return out;
}
