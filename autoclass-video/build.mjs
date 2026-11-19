// Builds the autoclass lesson video project from the lesson below:
//   1. Uncle Tommy speaks every line (the same Inworld voice video-container/voice.mjs uses),
//      cached in assets/voice/ by text, so a rebuild only voices lines that changed.
//   2. Every scene is timed to its voice lines, and the scene files, index.html and the
//      autoclass cues (public/autoclass/<id>.cues.json) are written from those times, so the
//      pause points always match the video.
//
//   node build.mjs            then   npx hyperframes check && npx hyperframes render ...
//   put the render at out/<id>.mp4, then   node ../scripts/upload-autoclass.mjs --remote
//   (the media goes to R2; only the cues file is kept in git)
//
// Questions: the video pauses right after Tommy asks; the autoclass page sends the quiz to the
// phones and plays on into the reveal when everyone has answered or time is up.
//
// Polls (kind: "poll") have no right answer and give no points. A poll is not a scene and does
// not change the video: the page pauses between the two scenes around it, draws the question
// and the live bars itself, and plays Tommy's lines from their own files in out/ (R2 /uploads/autoclass/).
//
// Results: after each question the page pauses once more, at `result.at` (the end of the question's
// scene, after Tommy has revealed the answer), shows how the class answered and plays a few of
// Tommy's lines about it. They are all recorded here, many for each situation, so he does not say the
// same thing every time and nothing is made up in class (see public/autoclass-analysis.js, which picks).
//
// Raise-a-hand questions (lesson.tutor) work the same way: the video does not change. The page
// answers a student's question only at one of the `breaks` below, a moment in a teaching scene
// after Tommy has finished a line, while the small Tommy sits at `anchor`. It plays one of the
// lead-in lines, shows the question, plays the answer, then a lead-out line and resumes the video.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROUTER = (process.env.ROUTER_BASE || "https://newcms.lango.ai/api/router").replace(/\/$/, "");
const VOICE = "default-zylgts2tamenvybeti3z0w__uncle_tommy";
const MODEL = "inworld-tts-1.5-max";
const SPEAKING_RATE = 1.0; // a little slower than the worker's 1.12, for young learners
const TOMMY_LOOP = 40; // assets/tommy-talking.webm
const GAP = 0.35; // silence between two lines in the same beat
// Everything the autoclass page plays lives in R2, not in git: this build writes it to out/
// (gitignored), and scripts/upload-autoclass.mjs puts out/ at /uploads/autoclass/ in R2.
const OUT = "out";
const MEDIA_URL = "/uploads/autoclass";
// The same talking loop the lecture videos use; it is kept in git only there.
const TOMMY_SOURCE = "../video-container/assets/tommy-talking.webm";

const lesson = {
  id: "animal-homes",
  title: "Animal Homes",
  eyebrow: "Lango English · Animal Homes",
  intro: {
    title: ["Where", "do", "animals", "live?"],
    hl: 2,
    sub: "Watch, then answer each question on your phone.",
    emojis: ["🐦", "🐝", "🐟", "🐇", "🐻", "🐸"],
    say: ["Hello everyone, I'm Uncle Tommy! Today, let's find out where animals live.",
      "Watch with me, and when a question pops up, answer on your phone. Ready? Let's go!"],
  },
  scenes: [
    {
      kind: "teach",
      title: ["Every", "animal", "needs", "a", "home."],
      hl: 1,
      say: "Every animal needs a home.",
      pairs: [
        { emoji: "🐦", home: "nest", sentence: "A bird lives in a nest.", say: "This is a bird. A bird lives in a nest.", repeat: "Say it with me: nest!" },
        { emoji: "🐝", home: "hive", sentence: "A bee lives in a hive.", say: "Look, a bee! A bee lives in a hive.", repeat: "Say it with me: hive!" },
        { emoji: "🐟", home: "river", sentence: "A fish lives in a river.", say: "And here is a fish. A fish lives in a river.", repeat: "Say it with me: river!" },
      ],
    },
    {
      // Say it with me: the video pauses, every phone records the sentence, then Tommy says it
      // once more. Encouragement only: no points, nothing kept (worker/room-open-answer.js).
      kind: "speak",
      emoji: "🐦",
      sentence: "A bird lives in a nest.",
      ask: "Now it's your turn to speak! Tap the microphone on your phone, and say: A bird lives in a nest.",
      again: "Let's say it together one more time. A bird lives in a nest. Well done for speaking!",
      seconds: 15,
    },
    {
      kind: "quiz",
      q: "Where does a bee live?",
      options: ["nest", "hive", "cave", "pond"],
      correct: 1,
      line: "A bee lives in a hive.",
      ask: "Question one! Where does a bee live? A nest, a hive, a cave, or a pond? Answer on your phone now!",
      reveal: "The answer is B, hive! A bee lives in a hive. Well done!",
      timeLimit: 20,
      // About the option most students picked wrong. Neutral wording: it can be one student or many.
      wrongLines: {
        nest: ["A nest is for a bird. A bee lives in a hive!", "Careful! Nests are for birds, but bees live in hives."],
        cave: ["A cave is for a bear. A bee lives in a hive!", "Caves are for bears, not bees. A bee lives in a hive."],
        pond: ["A pond is for a frog. A bee lives in a hive!", "Ponds are for frogs. Remember, a bee lives in a hive."],
      },
    },
    {
      kind: "poll",
      q: "Which animal do you like best?",
      options: ["🐦 bird", "🐝 bee", "🐟 fish"],
      ask: "Now, one just for fun. Which animal do you like best? The bird, the bee, or the fish? There is no wrong answer. Tap on your phone!",
      thanks: "Thank you, everyone! Now, let's keep going.",
      seconds: 20,
    },
    {
      kind: "teach",
      title: ["Some", "homes", "are", "on", "the", "ground."],
      hl: 1,
      say: "Some homes are on the ground, or even under it.",
      pairs: [
        { emoji: "🐇", home: "burrow", sentence: "A rabbit lives in a burrow.", say: "This is a rabbit. A rabbit lives in a burrow, under the ground.", repeat: "Say it with me: burrow!" },
        { emoji: "🐻", home: "cave", sentence: "A bear lives in a cave.", say: "Here is a big bear. A bear lives in a cave.", repeat: "Say it with me: cave!" },
        { emoji: "🐸", home: "pond", sentence: "A frog lives in a pond.", say: "And a little frog. A frog lives in a pond.", repeat: "Say it with me: pond!" },
      ],
    },
    {
      kind: "quiz",
      q: "Which animal lives in a burrow?",
      options: ["frog", "bear", "rabbit", "bird"],
      correct: 2,
      line: "A rabbit lives in a burrow.",
      ask: "Question two! Which animal lives in a burrow? A frog, a bear, a rabbit, or a bird? Answer on your phone now!",
      reveal: "The answer is C, rabbit! A rabbit lives in a burrow. Great job!",
      timeLimit: 20,
      wrongLines: {
        frog: ["A frog lives in a pond. A rabbit lives in a burrow!", "Frogs like ponds. The animal in a burrow is a rabbit."],
        bear: ["A bear lives in a cave. A rabbit lives in a burrow!", "Bears live in caves. It is the rabbit that lives in a burrow."],
        bird: ["A bird lives in a nest. A rabbit lives in a burrow!", "Birds have nests. The rabbit lives in a burrow."],
      },
    },
  ],
  outro: {
    rows: [["🐦", "bird", "nest"], ["🐝", "bee", "hive"], ["🐇", "rabbit", "burrow"], ["🐻", "bear", "cave"]],
    say: "Great job today, everyone! A bird lives in a nest. A bee lives in a hive. A rabbit lives in a burrow. And a bear lives in a cave. See you next time. Bye-bye!",
    bye: "See you next time!",
  },
};

// What Tommy says about a question's results. One bank per situation (public/autoclass-analysis.js
// explains each), several lines each so he does not repeat himself. Wording rules, because a line
// is played for any class size: no numbers, no names, never blame, and each line is true for its
// bank (so "most of you" only where it is at least 70%, and nothing says "everyone" unless all
// answered and all were right).
lesson.analysis = {
  leadIn: [
    "Let's see how we did!",
    "Okay, time to check our answers!",
    "Here come the results!",
    "Let's look at your answers together!",
  ],
  allRight: [
    "Wow! Every one of you got it right! Amazing!",
    "Perfect! You all got it right. Give yourselves a big clap!",
    "Hooray! Everyone got it right. You are super stars!",
    "Fantastic! Not one mistake. I am so proud of you!",
    "You all got it! What a great class!",
  ],
  mostRight: [
    "Great job! Most of you got it right!",
    "Well done! Lots of you knew this one.",
    "Nice work! Most of the class got it.",
    "Very good! Many of you got it right.",
    "Super! Most of you are really getting this.",
  ],
  mixed: [
    "Some of you got it, and some were not sure. That's okay!",
    "Hmm, the answers were mixed this time. Let's keep learning together.",
    "About half of you got it. Good try, everyone!",
    "It was a bit tricky, wasn't it? That's how we learn!",
    "Good thinking, everyone! Some of you were very close.",
  ],
  mostWrong: [
    "That was a tricky one! Only a few of you got it. Let's remember it together.",
    "Oh, that was hard! Don't worry, mistakes help us learn.",
    "Not many got this one, but that's okay. Now we know it!",
    "A tricky question! Let's remember the answer together.",
    "Good try! This one is hard. We will practise more.",
  ],
  noneRight: [
    "Oh, that was a really tricky one! Nobody got it this time. But now we know the answer!",
    "No worries! That was hard. Let's remember it together.",
    "That's okay, everyone! Even I think it was tricky. Now we know!",
    "Nobody got it this time, but you all tried. Good job trying!",
  ],
  noAnswers: [
    "Hmm, I didn't hear any answers this time. Let's try again on the next question!",
    "No answers this time. Don't be shy! Tap your answer next time.",
    "It looks like everyone was busy. Next time, tap your answer on your phone!",
    "I'm waiting for your answers! Let's try the next one.",
  ],
  singleRight: [
    "Nice one! You got it right!",
    "Well done! That's the right answer!",
    "You got it! Great job!",
  ],
  singleWrong: [
    "Good try! Now you know the answer.",
    "Not this time, but that's okay. Let's remember it together.",
    "Nice try! Let's learn it together.",
  ],
  someSilent: [
    "Some friends didn't answer in time. That's okay. Try to be quick next time!",
    "A few of you missed this one. Next time, tap your answer before the time is up.",
    "Don't forget to tap your answer on your phone, okay?",
    "I think some friends were still thinking. Let's try a little faster next time!",
  ],
};

// The same for a "say it with me" sentence. A transcription of young voices is often unsure, so
// "right" here is only "the phone heard the sentence well" and nothing ever sounds like a mistake.
lesson.speakAnalysis = {
  leadIn: [
    "Thank you for speaking! Let's have a look.",
    "Let's see how your speaking went!",
    "I was listening! Let's see.",
  ],
  allRight: [
    "Wow! You all said it so clearly!",
    "Amazing speaking, everyone! Give yourselves a clap!",
    "Perfect! Every one of you said it just right!",
  ],
  mostRight: [
    "Great speaking! Most of you said it really well.",
    "Well done! I heard lots of clear voices.",
    "Super! Most of you said it just right.",
  ],
  mixed: [
    "Good speaking, everyone! Some of you were very close.",
    "Nice try, everyone! Speaking gets easier every time.",
    "Good job speaking up! Let's keep practising.",
  ],
  mostWrong: [
    "That was a long sentence! Good try, everyone.",
    "Speaking is hard, and you were brave to try!",
    "Nice work trying! Let's practise it again together.",
  ],
  noneRight: [
    "Good try, everyone! It was a long sentence. Let's practise more.",
    "That's okay! Speaking takes practice. You were brave to try!",
    "Sometimes the phone does not hear us well. Keep trying!",
  ],
  noAnswers: [
    "Hmm, I didn't hear anyone this time. Next time, tap the microphone and say it!",
    "Don't be shy! Next time, tap the microphone on your phone and speak.",
    "I'm waiting to hear your voice! Let's try next time.",
  ],
  singleRight: [
    "Wonderful! You said it perfectly!",
    "Great speaking! That was so clear!",
    "Well done! You said it just right!",
  ],
  singleWrong: [
    "Good try! You were very brave to speak.",
    "Nice try! Keep practising and it gets easier.",
    "Thank you for speaking! Let's practise it again.",
  ],
  someSilent: [
    "Some friends didn't speak this time. Next time, tap the microphone and try!",
    "Don't forget to tap the microphone and speak, okay?",
    "I hope to hear more voices next time!",
  ],
};

// Raise-a-hand questions. The outline is all the model knows about the lesson, so it is built
// from the lesson itself. Lead-ins and lead-outs are said around each answer (they cannot name
// the student or the question, so they are the same few lines every time).
lesson.tutor = {
  maxAnswers: 3, // for the whole class
  language: "en", // what Tommy answers in, unless the student asked in Chinese
  sttLanguage: "yue", // what the students' recordings are read as (a Cantonese class)
  outline: [
    "Young children learn where animals live, in simple English.",
    ...lesson.scenes.filter((s) => s.kind === "teach").flatMap((s) => s.pairs.map((p) => p.sentence)),
    ...lesson.scenes.filter((s) => s.kind === "quiz").map((s) => `Quiz: ${s.q} Answer: ${s.options[s.correct]}.`),
  ].join(" "),
  leadIns: [
    "Ooh, I see a hand up! Let me hear your question.",
    "Wait, wait! A friend has a question for me.",
    "Oh, someone has a question! Let me think.",
  ],
  leadOuts: [
    "Great question! Now, back to our lesson.",
    "Thank you for asking! Let's keep going.",
    "I hope that helps! Now, where were we?",
  ],
};

// ---- Voice ----

async function voice(text) {
  const key = createHash("sha1").update(`${VOICE}|${MODEL}|${SPEAKING_RATE}|${text}`).digest("hex").slice(0, 12);
  const file = `assets/voice/${key}.mp3`;
  if (!existsSync(file)) {
    let lastError;
    for (let attempt = 0; attempt < 3 && !existsSync(file); attempt += 1) {
      try {
        const res = await fetch(`${ROUTER}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ text, voice: VOICE, model: MODEL, language: "en-US", audioEncoding: "MP3", sampleRate: 24000, speakingRate: SPEAKING_RATE }),
          signal: AbortSignal.timeout(90_000),
        });
        const data = await res.json().catch(() => ({}));
        const match = typeof data?.audio === "string" && data.audio.match(/^data:audio\/(?:mpeg|mp3);base64,([A-Za-z0-9+/=\s]+)$/);
        if (!res.ok || !match) throw new Error(`TTS failed (${res.status}) for: ${text}`);
        writeFileSync(file, Buffer.from(match[1].replace(/\s/g, ""), "base64"));
        console.log(`voiced: ${text}`);
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    if (!existsSync(file)) throw lastError;
  }
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
  return { file, seconds, text };
}

// ---- Helpers ----

const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const words = (list, hl) => list.map((w, i) => `<span class="word${i === hl ? " hl" : ""}">${esc(w)}${i < list.length - 1 ? " " : ""}</span>`).join("");
const LETTERS = ["A", "B", "C", "D"];

const audioClips = []; // { id, file, at (absolute), seconds }
let audioCount = 0;
function placeVoice(v, at) {
  audioCount += 1;
  audioClips.push({ id: `vo-${String(audioCount).padStart(2, "0")}`, file: v.file, at: r3(at), seconds: r3(v.seconds) });
}

function sceneFile(id, body, script, extraCss = "") {
  return `<template>
  <style>
    #root {
      position: absolute;
      inset: 0;
    }${extraCss}
  </style>
  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080">
${body}
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });
${script}
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
`;
}

// ---- Scenes. Each returns { id, duration, html } and places its voice at sceneStart + local time. ----

async function introScene(start) {
  const id = "intro";
  const [v1, v2] = [await voice(lesson.intro.say[0]), await voice(lesson.intro.say[1])];
  const t1 = 0.6;
  const t2 = t1 + v1.seconds + GAP;
  const end = t2 + v2.seconds + 0.8;
  placeVoice(v1, start + t1);
  placeVoice(v2, start + t2);
  const body = `    <div id="intro-eyebrow" class="eyebrow">${esc(lesson.eyebrow)}</div>
    <h1 id="intro-title">${lesson.intro.title.map((w, i) => `<span class="word${i === lesson.intro.hl ? " hl" : ""}">${esc(w)}</span>`).join("<br />").replace("<br /><span class=\"word\">do", " <span class=\"word\">do")}</h1>
    <p id="intro-sub">${esc(lesson.intro.sub)}</p>
    <div id="intro-today">${lesson.intro.emojis.map((e) => `<span class="em">${e}</span>`).join("")}</div>`;
  const script = `      tl.fromTo("#intro-title .word", { opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out", stagger: 0.09 }, 0.5);
      tl.fromTo("#intro-sub", { opacity: 0, filter: "blur(8px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(t2)});
      tl.fromTo("#intro-today .em", { opacity: 0, y: 24, scale: 0.7 },
        { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.6)", stagger: 0.3 }, ${r3(t2 + 0.6)});
      tl.to(["#intro-eyebrow", "#intro-title", "#intro-sub", "#intro-today"],
        { opacity: 0, filter: "blur(8px)", duration: 0.2, ease: "power3.in", stagger: 0.04 }, ${r3(end - 0.35)});`;
  const css = `
    #intro-title {
      position: absolute;
      left: 150px;
      top: 230px;
      width: 900px;
      font-size: 128px;
      font-weight: 900;
      line-height: 1.02;
      letter-spacing: -0.02em;
    }
    #intro-sub {
      position: absolute;
      left: 150px;
      top: 680px;
      width: 900px;
      font-size: 50px;
      font-weight: 700;
      color: var(--muted);
      line-height: 1.3;
    }
    #intro-today {
      position: absolute;
      left: 150px;
      top: 860px;
      display: flex;
      gap: 34px;
      font-size: 84px;
    }
    #intro-today .em {
      display: inline-block;
    }`;
  return { id, duration: r3(end), html: sceneFile(id, body, script, css), tommy: "big-right" };
}

async function teachScene(start, scene, n) {
  const id = `teach${n}`;
  const vTitle = await voice(scene.say);
  placeVoice(vTitle, start + 0.4);
  let t = 0.4 + vTitle.seconds + 0.5;
  const parts = [];
  const lines = [];
  const breaks = [];
  for (const [i, pair] of scene.pairs.entries()) {
    const vSay = await voice(pair.say);
    const vRepeat = await voice(pair.repeat);
    const at = t;
    const sayAt = at + 0.2;
    const repeatAt = sayAt + vSay.seconds + 0.4;
    const leaveAt = repeatAt + vRepeat.seconds + 1.4; // a beat for the class to say it back
    placeVoice(vSay, start + sayAt);
    placeVoice(vRepeat, start + repeatAt);
    // Quiet moment: Tommy has finished and the class is still saying the word; the pair leaves
    // 0.5 s after the video resumes.
    breaks.push(r3(start + repeatAt + vRepeat.seconds + 0.9));
    parts.push(`    <div id="${id}-pair${i}" class="pair">
      <div id="${id}-animal${i}" class="animal">${pair.emoji}</div>
      <div id="${id}-arrow${i}" class="arrow"></div>
      <div id="${id}-home${i}" class="home">${esc(pair.home)}</div>
    </div>
    <p id="${id}-sentence${i}" class="sentence">${esc(pair.sentence)}</p>
    <p id="${id}-say${i}" class="say">Say it with me: <b>${esc(pair.home)}</b>!</p>`);
    // The home and its sentence land as Tommy reaches the second sentence (about halfway).
    const homeAt = sayAt + vSay.seconds * 0.45;
    lines.push(`      tl.fromTo("#${id}-pair${i}", { opacity: 0 }, { opacity: 1, duration: 0.01 }, ${r3(at)});
      tl.fromTo("#${id}-animal${i}", { scale: 0.6, opacity: 0, filter: "blur(10px)" },
        { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.55, ease: "back.out(1.4)" }, ${r3(at)});
      tl.fromTo("#${id}-arrow${i}", { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: "power2.inOut" }, ${r3(homeAt - 0.35)});
      tl.fromTo("#${id}-home${i}", { opacity: 0, x: -40, filter: "blur(10px)" },
        { opacity: 1, x: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, ${r3(homeAt)});
      tl.fromTo("#${id}-sentence${i}", { opacity: 0, filter: "blur(8px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(homeAt + 0.3)});
      tl.fromTo("#${id}-say${i}", { opacity: 0, scale: 0.8 },
        { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.6)" }, ${r3(repeatAt)});
      tl.to(["#${id}-pair${i}", "#${id}-sentence${i}", "#${id}-say${i}"],
        { opacity: 0, filter: "blur(10px)", duration: 0.22, ease: "power3.in" }, ${r3(leaveAt)});`);
    t = leaveAt + 0.35;
  }
  const end = t + 0.2;
  const body = `    <div id="${id}-eyebrow" class="eyebrow">${esc(lesson.eyebrow)}</div>
    <h2 id="${id}-title" class="section-title">${words(scene.title, scene.hl)}</h2>
${parts.join("\n")}`;
  const script = `      tl.fromTo("#${id}-eyebrow", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power4.out" }, 0.2);
      tl.fromTo("#${id}-title .word", { opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out", stagger: 0.08 }, 0.3);
${lines.join("\n")}
      tl.to(["#${id}-eyebrow", "#${id}-title"], { opacity: 0, filter: "blur(8px)", duration: 0.2, ease: "power3.in" }, ${r3(end - 0.3)});`;
  return { id, duration: r3(end), html: sceneFile(id, body, script), tommy: "small", breaks };
}

// Records each text in Tommy's voice into out/analysis/ and returns [{ text, url }].
async function clips(name, texts) {
  mkdirSync(`${OUT}/analysis`, { recursive: true });
  const out = [];
  for (const [i, text] of texts.entries()) {
    const file = `${lesson.id}-${name}-${i + 1}.mp3`;
    copyFileSync((await voice(text)).file, `${OUT}/analysis/${file}`);
    out.push({ text, url: `${MEDIA_URL}/analysis/${file}` });
  }
  return out;
}

async function quizScene(start, scene, n) {
  const id = `quiz${n}`;
  const vAsk = await voice(scene.ask);
  const vReveal = await voice(scene.reveal);
  const askAt = 0.5;
  const pauseAt = Math.max(2.9, askAt + vAsk.seconds + 0.3); // the page pauses here
  const revealAt = pauseAt + 1.0;
  const end = revealAt + 0.1 + vReveal.seconds + 1.4;
  placeVoice(vAsk, start + askAt);
  placeVoice(vReveal, start + revealAt + 0.1);
  audioClips.push({ id: `sfx-correct-${n}`, file: "assets/correct.mp3", at: r3(start + revealAt + 0.03), seconds: 2, volume: 0.7, track: 4 });
  const opts = scene.options.map((o, i) => `      <div id="${id}-opt${i}" class="opt"><span class="letter">${LETTERS[i]}</span><span>${esc(o)}</span><span id="${id}-tick${i}" class="tick">✓</span></div>`).join("\n");
  const body = `    <div id="${id}-tag" class="quiz-tag">Question ${n}</div>
    <h2 id="${id}-q" class="quiz-q">${words(scene.q.split(" "), -1)}</h2>
    <div id="${id}-options" class="options" data-hold>
${opts}
    </div>
    <p id="${id}-hint" class="phone-hint">📱 Answer on your phone</p>
    <p id="${id}-answer" class="answer-line">${esc(scene.line)}</p>`;
  const dim = scene.options.map((_, i) => i).filter((i) => i !== scene.correct)
    .map((i) => `      tl.to("#${id}-opt${i}", { opacity: 0.3, duration: 0.3, ease: "power2.out" }, ${r3(revealAt)});`).join("\n");
  const script = `      tl.fromTo("#${id}-tag", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)" }, 0.2);
      tl.fromTo("#${id}-q .word", { opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out", stagger: 0.08 }, 0.5);
      tl.fromTo("#${id}-options .opt", { opacity: 0, y: 30, filter: "blur(8px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out", stagger: 0.07 }, 1.4);
      tl.fromTo("#${id}-hint", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, 2.3);
      // Paused at ${r3(pauseAt)} s while the class answers; the reveal starts at ${r3(revealAt)} s.
      tl.to("#${id}-hint", { opacity: 0, filter: "blur(8px)", duration: 0.15, ease: "power3.in" }, ${r3(revealAt - 0.4)});
${dim}
      tl.set("#${id}-opt${scene.correct}", { className: "opt correct-bg" }, ${r3(revealAt)});
      tl.fromTo("#${id}-opt${scene.correct}", { scale: 1 }, { scale: 1.04, duration: 0.25, ease: "power2.out" }, ${r3(revealAt)});
      tl.to("#${id}-opt${scene.correct}", { scale: 1, duration: 0.35, ease: "power2.inOut" }, ${r3(revealAt + 0.25)});
      tl.fromTo("#${id}-tick${scene.correct}", { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.8)" }, ${r3(revealAt + 0.05)});
      tl.fromTo("#${id}-answer", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(revealAt + 0.8)});
      tl.to(["#${id}-tag", "#${id}-q", "#${id}-options", "#${id}-answer"], { opacity: 0, filter: "blur(10px)", duration: 0.25, ease: "power3.in" }, ${r3(end - 0.35)});`;
  // The wrong-answer lines, keyed by the option's index (the page counts picks by index).
  const wrong = {};
  for (const [text, lines] of Object.entries(scene.wrongLines || {})) {
    const index = scene.options.indexOf(text);
    if (index < 0 || index === scene.correct) throw new Error(`wrongLines "${text}" is not a wrong option of "${scene.q}"`);
    wrong[index] = await clips(`q${n}-wrong-${index + 1}`, lines);
  }
  const cue = {
    at: r3(start + pauseAt),
    resumeAt: r3(start + pauseAt),
    // Where the page pauses again for the results: the answer has been revealed and the scene is
    // about to fade out, so the next scene still follows on from this one.
    result: { at: r3(start + end - 0.5), key: `q${n}`, wrong },
    exercise: {
      id: `autoclass-${lesson.id}-q${n}`,
      type: "mcquiz",
      title: `${lesson.title} · Question ${n}`,
      items: [{
        title: scene.q,
        timeLimit: scene.timeLimit || 20,
        options: scene.options.map((text, i) => (i === scene.correct ? { text, isCorrect: true } : { text })),
      }],
    },
  };
  return { id, duration: r3(end), html: sceneFile(id, body, script), tommy: "hidden", cue };
}

// Say it with me. The page pauses at `at` while the phones record, plays on into Tommy saying it
// once more, and pauses again at `result.at` for how the class did. The page counts each phone's
// verdict (great, almost, tried) as option 0, 1 or 2 of a three-option question, so the results
// page and the analysis picker work as they do for a quiz.
async function speakScene(start, scene, n) {
  const id = `say${n}`;
  const vAsk = await voice(scene.ask);
  const vAgain = await voice(scene.again);
  const askAt = 0.5;
  const pauseAt = askAt + vAsk.seconds + 0.3;
  const againAt = pauseAt + 0.8;
  const end = againAt + vAgain.seconds + 1.4;
  placeVoice(vAsk, start + askAt);
  placeVoice(vAgain, start + againAt);
  const body = `    <div id="${id}-tag" class="quiz-tag">Your turn to speak</div>
    <div id="${id}-emoji" class="say-emoji">${scene.emoji}</div>
    <h2 id="${id}-line" class="say-line">${words(scene.sentence.split(" "), -1)}</h2>
    <p id="${id}-hint" class="phone-hint">🎤 Say it on your phone</p>
    <p id="${id}-done" class="answer-line">Well done!</p>`;
  // Tommy reads the sentence about a third of the way into each line: light the words up then.
  const wordsAt = (lineAt, v) => r3(lineAt + v.seconds * 0.38);
  const script = `      tl.fromTo("#${id}-tag", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)" }, 0.2);
      tl.fromTo("#${id}-emoji", { opacity: 0, scale: 0.6, filter: "blur(10px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "back.out(1.4)" }, 0.4);
      tl.fromTo("#${id}-line .word", { opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out", stagger: 0.08 }, ${wordsAt(askAt, vAsk)});
      tl.fromTo("#${id}-hint", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(pauseAt - 0.6)});
      // Paused at ${r3(pauseAt)} s while the class speaks; Tommy says it again from ${r3(againAt)} s.
      tl.to("#${id}-hint", { opacity: 0, filter: "blur(8px)", duration: 0.15, ease: "power3.in" }, ${r3(againAt - 0.4)});
      tl.fromTo("#${id}-line .word", { color: "#2b1d3a" }, { color: "#743c9b", duration: 0.2, ease: "power2.out", stagger: 0.18 }, ${wordsAt(againAt, vAgain)});
      tl.fromTo("#${id}-done", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(againAt + vAgain.seconds * 0.8)});
      tl.to(["#${id}-tag", "#${id}-emoji", "#${id}-line", "#${id}-done"], { opacity: 0, filter: "blur(10px)", duration: 0.25, ease: "power3.in" }, ${r3(end - 0.35)});`;
  const css = `
    .say-emoji {
      position: absolute;
      left: 0;
      right: 0;
      top: 200px;
      text-align: center;
      font-size: 190px;
    }
    .say-line {
      position: absolute;
      left: 150px;
      right: 150px;
      top: 500px;
      text-align: center;
      font-size: 104px;
      font-weight: 900;
      letter-spacing: -0.01em;
    }`;
  const cue = {
    at: r3(start + pauseAt),
    resumeAt: r3(start + pauseAt),
    speak: { sentence: scene.sentence, seconds: scene.seconds || 15 },
    result: { at: r3(start + end - 0.5), key: id, wrong: {} },
    exercise: {
      id: `autoclass-${lesson.id}-${id}`,
      type: "openanswer",
      practice: true,
      title: `${lesson.title} · Say it with me`,
      items: [{ topic: scene.sentence, correctAnswer: scene.sentence, sttLanguage: "en", timeLimit: scene.seconds || 15 }],
    },
  };
  return { id, duration: r3(end), html: sceneFile(id, body, script, css), tommy: "hidden", cue };
}

// A poll pauses the video at `at`, the boundary between two scenes, and resumes from there.
async function pollCue(at, scene, n) {
  const audio = {};
  for (const [key, name, text] of [["askAudio", "ask", scene.ask], ["doneAudio", "thanks", scene.thanks]]) {
    if (!text) continue;
    const file = `${lesson.id}-poll${n}-${name}.mp3`;
    copyFileSync((await voice(text)).file, `${OUT}/${file}`);
    audio[key] = `${MEDIA_URL}/${file}`;
  }
  return {
    at: r3(at),
    resumeAt: r3(at),
    poll: { id: `autoclass-${lesson.id}-poll${n}`, question: scene.q, options: scene.options, seconds: scene.seconds || 20, ...audio },
  };
}

// What the page needs to answer a student's question (see the header). The live Tommy it shows
// is the same talking clip as the video's, placed exactly where the small Tommy is, so the answer
// card grows out of him instead of cutting in.
async function tutorBlock(scenes) {
  const t = lesson.tutor;
  const lines = {};
  for (const [key, list] of [["leadIns", t.leadIns], ["leadOuts", t.leadOuts]]) {
    lines[key] = [];
    for (const [i, text] of list.entries()) {
      const file = `${lesson.id}-tutor-${key === "leadIns" ? "in" : "out"}${i + 1}.mp3`;
      copyFileSync((await voice(text)).file, `${OUT}/${file}`);
      lines[key].push(`${MEDIA_URL}/${file}`);
    }
  }
  copyFileSync("assets/tommy-talking.webm", `${OUT}/tommy-talking.webm`);
  const small = TOMMY_POS.small;
  return {
    enabled: true,
    maxAnswers: t.maxAnswers,
    language: t.language,
    sttLanguage: t.sttLanguage,
    outline: t.outline,
    tommyVideo: `${MEDIA_URL}/tommy-talking.webm`,
    // Where the small Tommy is, in the video's 1920×1080 pixels (the clip is 552×648).
    anchor: { x: small.x, y: small.y, w: r3(552 * small.scale), h: r3(648 * small.scale) },
    ...lines,
    breaks: scenes.flatMap((s) => s.breaks || []),
  };
}

async function outroScene(start) {
  const id = "outro";
  const v = await voice(lesson.outro.say);
  placeVoice(v, start + 0.5);
  const end = 0.5 + v.seconds + 2.2;
  const rows = lesson.outro.rows.map(([e, animal, home]) =>
    `      <div class="recap-row"><span class="em">${e}</span><span>${esc(animal)}</span><span class="to">lives in a</span><span class="h">${esc(home)}</span></div>`).join("\n");
  // Each recap row lands as Tommy says it: spread across the middle of his line.
  const rowStart = 0.5 + v.seconds * 0.22;
  const rowStep = (v.seconds * 0.6) / lesson.outro.rows.length;
  const body = `    <h2 id="outro-title"><span class="word">Great </span><span class="word hl">job!</span></h2>
    <div id="outro-recap">
${rows}
    </div>
    <p id="outro-bye" data-hold>${esc(lesson.outro.bye)}</p>`;
  const script = `      tl.fromTo("#outro-title .word", { opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out", stagger: 0.1 }, 0.5);
      tl.fromTo("#outro-recap .recap-row", { opacity: 0, x: 40, filter: "blur(8px)" },
        { opacity: 1, x: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out", stagger: ${r3(rowStep)} }, ${r3(rowStart)});
      tl.fromTo("#outro-bye", { opacity: 0, filter: "blur(8px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(0.5 + v.seconds * 0.85)});`;
  const css = `
    #outro-title {
      position: absolute;
      left: 900px;
      top: 210px;
      font-size: 120px;
      font-weight: 900;
      letter-spacing: -0.02em;
    }
    #outro-recap {
      position: absolute;
      left: 900px;
      top: 400px;
      display: flex;
      flex-direction: column;
      gap: 26px;
    }
    .recap-row {
      display: flex;
      align-items: center;
      gap: 24px;
      font-size: 54px;
      font-weight: 800;
    }
    .recap-row .em {
      font-size: 64px;
      width: 80px;
      text-align: center;
    }
    .recap-row .to {
      color: var(--muted);
      font-weight: 700;
    }
    .recap-row .h {
      color: var(--purple);
      font-weight: 900;
    }
    #outro-bye {
      position: absolute;
      left: 900px;
      top: 860px;
      font-size: 56px;
      font-weight: 900;
      color: var(--purple-deep);
    }`;
  return { id, duration: r3(end), html: sceneFile(id, body, script, css), tommy: "big-left" };
}

// ---- Assemble ----

// Talking Tommy (a 552×648 bust with alpha) sits in one wrapper that the root timeline moves
// between scenes: big beside the intro and outro, small in the corner while teaching, away
// during questions so the options and the live strip have the room.
const TOMMY_POS = {
  "big-right": { x: 1180, y: 250, scale: 1.2, opacity: 1 },
  small: { x: 1600, y: 735, scale: 0.5, opacity: 1 },
  hidden: { x: 1600, y: 735, scale: 0.5, opacity: 0 },
  "big-left": { x: 170, y: 270, scale: 1.15, opacity: 1 },
};

async function main() {
  mkdirSync("assets/voice", { recursive: true });
  mkdirSync(OUT, { recursive: true });
  if (!existsSync("assets/tommy-talking.webm")) copyFileSync(TOMMY_SOURCE, "assets/tommy-talking.webm");
  const scenes = [];
  let t = 0;
  const push = (s) => {
    s.start = r3(t);
    scenes.push(s);
    t += s.duration;
  };
  push(await introScene(t));
  let teach = 0;
  let quiz = 0;
  let speak = 0;
  const pollCues = [];
  for (const scene of lesson.scenes) {
    if (scene.kind === "teach") push(await teachScene(t, scene, ++teach));
    else if (scene.kind === "poll") pollCues.push(await pollCue(t, scene, pollCues.length + 1));
    else if (scene.kind === "speak") push(await speakScene(t, scene, ++speak));
    else push(await quizScene(t, scene, ++quiz));
  }
  push(await outroScene(t));
  const total = r3(t);

  for (const s of scenes) writeFileSync(`compositions/${s.id}.html`, s.html);

  const hosts = scenes.map((s) => `      <div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html"
        data-start="${s.start}" data-duration="${s.duration}" data-track-index="1" data-track-kind="graphics"
        data-width="1920" data-height="1080" style="z-index: 1"></div>`).join("\n");
  const tommyClips = [];
  for (let at = 0, n = 1; at < total; at += TOMMY_LOOP, n += 1) {
    tommyClips.push(`        <video id="tommy-${n}" class="clip" src="assets/tommy-talking.webm" data-start="${r3(at)}" data-duration="${r3(Math.min(TOMMY_LOOP, total - at))}" data-track-index="2" muted playsinline></video>`);
  }
  const audio = audioClips.map((a) => `      <audio id="${a.id}" class="clip" src="${a.file}" data-start="${a.at}" data-duration="${a.seconds}"
        data-track-index="${a.track ?? 3}" data-volume="${a.volume ?? 1}"></audio>`).join("\n");
  const first = TOMMY_POS[scenes[0].tommy];
  const moves = [];
  for (let i = 1; i < scenes.length; i += 1) {
    if (scenes[i].tommy === scenes[i - 1].tommy) continue;
    const p = TOMMY_POS[scenes[i].tommy];
    const at = scenes[i].start - (p.opacity === 0 ? 0.3 : 0.1);
    moves.push(`      tl.to("#tommy", { x: ${p.x}, y: ${p.y}, scale: ${p.scale}, opacity: ${p.opacity}, duration: 0.6, ease: "power2.inOut" }, ${r3(Math.max(0, at))});`);
  }

  writeFileSync("index.html", `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <!-- Written by build.mjs: edit the lesson there and rebuild, or the cues will drift from the video.
         Shared styles come from assets/lesson.css. -->
    <style>
${readFileSync("assets/lesson.css", "utf8").replace(/^/gm, "      ").trimEnd()}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${total}"
      data-width="1920"
      data-height="1080"
    >
      <div id="ground" class="clip" data-start="0" data-duration="${total}" data-track-index="0" style="z-index: 0"></div>

${hosts}

      <div id="tommy" style="z-index: 5">
${tommyClips.join("\n")}
      </div>

${audio}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#tommy", { x: ${first.x + 160}, y: ${first.y}, scale: ${first.scale}, opacity: 0 },
        { x: ${first.x}, y: ${first.y}, scale: ${first.scale}, opacity: 1, duration: 0.8, ease: "expo.out" }, 0.2);
${moves.join("\n")}
      tl.to("#tommy", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${r3(total - 0.5)});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`);

  const tutor = await tutorBlock(scenes);
  const analysis = {};
  for (const [bank, texts] of Object.entries(lesson.analysis)) analysis[bank] = await clips(`an-${bank}`, texts);
  const speakAnalysis = {};
  for (const [bank, texts] of Object.entries(lesson.speakAnalysis)) speakAnalysis[bank] = await clips(`say-${bank}`, texts);

  const cues = {
    title: lesson.title,
    video: `${MEDIA_URL}/${lesson.id}.mp4`, // render into out/<id>.mp4
    source: "autoclass-video/build.mjs (rebuild there; do not edit by hand)",
    duration: total,
    cues: [...scenes.filter((s) => s.cue).map((s) => s.cue), ...pollCues].sort((a, b) => a.at - b.at),
    tutor,
    analysis,
    speakAnalysis,
  };
  writeFileSync(`../public/autoclass/${lesson.id}.cues.json`, `${JSON.stringify(cues, null, 2)}\n`);

  console.log(`total ${total}s`);
  for (const s of scenes) console.log(`  ${s.id.padEnd(7)} ${String(s.start).padStart(7)}  +${s.duration}${s.cue ? `   pause at ${s.cue.at}` : ""}`);
  console.log(`  tutor breaks: ${tutor.breaks.join(", ")}`);
  for (const [i, c] of pollCues.entries()) console.log(`  poll${i + 1}   ${String(c.at).padStart(7)}  (page only; the video does not change)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
