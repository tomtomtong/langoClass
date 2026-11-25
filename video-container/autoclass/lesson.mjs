// Builds one autoclass lesson as a HyperFrames project from a lesson script (lib/autoclass-script.mjs
// checks and normalises it; this file trusts that). Used by the render container
// (video-container/autoclass/job.mjs) and by the laptop preview (autoclass-video/build.mjs), so the
// two cannot drift.
//
//   buildLesson(dir, script, { voice, mediaUrl, media })
//     voice(text) → { file, seconds }   an mp3 of Tommy saying `text`, `file` relative to `dir`
//     media(url) → file                 a quiz picture, sound clip or reveal video (/uploads/autoclass/_media/…)
//                                       already in the project, `file` relative to `dir`; needed
//                                       only when a quiz has an `image` or a `clip`
//     mediaUrl                          where the media will be served, e.g. /uploads/autoclass/<id>/<renderId>
//   writes  dir/index.html, dir/compositions/*.html, dir/assets/{lesson.css,correct.mp3,tommy-talking.webm}
//           dir/out/  everything the page plays besides the video: analysis/*.mp3, poll and tutor mp3s,
//                     tommy-talking.webm, cues.json (render the video to dir/out/<id>.mp4)
//   returns { total, cues, scenes }
//
// Every scene is timed to its voice lines and the cues are written from the same times, so the pause
// points always match the video.
//
// Questions: the video pauses right after Tommy asks; the autoclass page sends the quiz to the phones
// and plays on into the reveal when everyone has answered or time is up.
//
// Polls have no right answer and give no points. A poll is not a scene and does not change the video:
// the page pauses between the two scenes around it, draws the question and the live bars itself, and
// plays Tommy's lines from their own files.
//
// Results: after each question the page pauses once more, at `result.at` (the end of the question's
// scene, after Tommy has revealed the answer), shows how the class answered and plays a few of Tommy's
// lines about it, picked from the banks (public/autoclass-analysis.js picks).
//
// Raise-a-hand questions: the page answers a student's question only at one of the tutor `breaks`, a
// moment in a teaching scene after Tommy has finished a line, while the small Tommy sits at `anchor`.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = path.join(HERE, "assets");
// The same talking loop the lecture videos use.
export const TOMMY_SOURCE = path.join(HERE, "..", "assets", "tommy-talking.webm");
const TOMMY_LOOP = 40; // seconds in tommy-talking.webm
const GAP = 0.35; // silence between two lines in the same beat
const LETTERS = ["A", "B", "C", "D"];

// Talking Tommy (a 552×648 bust with alpha) sits in one wrapper that the root timeline moves
// between scenes: big beside the intro and outro, small in the corner while teaching, away during
// questions so the options and the live strip have the room.
const TOMMY_POS = {
  "big-right": { x: 1180, y: 250, scale: 1.2, opacity: 1 },
  small: { x: 1600, y: 735, scale: 0.5, opacity: 1 },
  hidden: { x: 1600, y: 735, scale: 0.5, opacity: 0 },
  "big-left": { x: 170, y: 270, scale: 1.15, opacity: 1 },
};

const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Option text gets smaller as it gets longer, so two or three lines fit inside the box instead of
// spilling out of it. Chinese characters count as one, Latin letters about half.
const optWeight = (text) => [...String(text)].reduce((sum, ch) => sum + (ch.codePointAt(0) >= 0x2e80 ? 1 : 0.55), 0);
const optSize = (text) => {
  const w = optWeight(text);
  return w <= 6 ? "" : w <= 16 ? "opt-md" : w <= 27 ? "opt-sm" : "opt-xs";
};
const words = (list, hl) => list.map((w, i) => `<span class="word${i === hl ? " hl" : ""}">${esc(w)}${i < list.length - 1 ? " " : ""}</span>`).join("");

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

// The words the video writes itself (not from the script), in the lesson's language: Cantonese for
// a yue (or zh-HK) voice, else English. Values are HTML-safe; `word` is escaped by the caller.
const LABELS = {
  en: {
    question: (n) => `Question ${n}`,
    answerOnPhone: "📱 Answer on your phone",
    speakTag: "Your turn to speak",
    speakHint: "🎤 Say it on your phone",
    wellDone: "Well done!",
    askTag: "Your turn to answer",
    warmupTag: "Warm-up",
    shareTag: "Share with us",
    askHint: "🎤 Answer on your phone",
    sayWithMe: (word) => `Say it with me: <b>${word}</b>!`,
    spellTag: "Spelling race!",
    spellHint: "📱 Spell on your phone",
    listen: "🎵 Listen…",
    adTag: "📺 The original ad",
    outroTitle: ["Great ", "job!"],
  },
  yue: {
    question: (n) => `第 ${n} 題`,
    answerOnPhone: "📱 用手機作答",
    speakTag: "到你講",
    speakHint: "🎤 用手機講出嚟",
    wellDone: "做得好！",
    askTag: "到你答",
    warmupTag: "熱身",
    shareTag: "同大家分享",
    askHint: "🎤 用手機講出你嘅答案",
    sayWithMe: (word) => `跟我講：<b>${word}</b>！`,
    spellTag: "串字比賽！",
    spellHint: "📱 用手機串字",
    listen: "🎵 聽下呢段…",
    adTag: "📺 當年嘅廣告",
    outroTitle: ["做得", "好！"],
  },
};

function noMedia(url) {
  throw new Error(`This build has no media files, but the lesson uses ${url}.`);
}

export function labelsFor(language) {
  const tag = String(language || "").toLowerCase();
  return tag.startsWith("yue") || tag === "zh-hk" ? LABELS.yue : LABELS.en;
}

export async function buildLesson(dir, lesson, { voice, mediaUrl, media = noMedia }) {
  const L = labelsFor(lesson.voice?.language);
  const OUT = path.join(dir, "out");
  const audioClips = []; // { id, file, at (absolute), seconds }
  const revealVideos = []; // { id, file, at (absolute), seconds, from }: played big after a quiz's answer
  let audioCount = 0;
  const placeVoice = (v, at) => {
    audioCount += 1;
    audioClips.push({ id: `vo-${String(audioCount).padStart(2, "0")}`, file: v.file, at: r3(at), seconds: r3(v.seconds) });
  };
  // Copies Tommy saying `text` into out/<name> and returns its URL.
  const publish = async (name, text) => {
    copyFileSync(path.join(dir, (await voice(text)).file), path.join(OUT, name));
    return `${mediaUrl}/${name}`;
  };
  const clips = async (name, texts) => {
    const out = [];
    for (const [i, text] of texts.entries()) out.push({ text, url: await publish(`analysis/${name}-${i + 1}.mp3`, text) });
    return out;
  };

  // ---- Scenes. Each returns { id, duration, html } and places its voice at sceneStart + local time. ----

  async function introScene(start) {
    const id = "intro";
    const intro = lesson.intro;
    const v = [];
    for (const text of intro.say) v.push(await voice(text));
    let t = 0.6;
    const lineAt = v.map((line) => {
      const at = t;
      t += line.seconds + GAP;
      return at;
    });
    const end = t - GAP + 0.8;
    v.forEach((line, i) => placeVoice(line, start + lineAt[i]));
    const subAt = lineAt[1] ?? lineAt[0] + 0.6;
    // Each title entry is one line; its words animate one by one.
    const title = intro.title
      .map((line, i) => line.split(/\s+/).map((w, j, all) => `<span class="word${i === intro.hl ? " hl" : ""}">${esc(w)}${j < all.length - 1 ? " " : ""}</span>`).join(""))
      .join("<br />");
    const body = `    <div id="intro-eyebrow" class="eyebrow">${esc(lesson.eyebrow)}</div>
    <h1 id="intro-title">${title}</h1>
    <p id="intro-sub">${esc(intro.sub)}</p>
    <div id="intro-today">${intro.emojis.map((e) => `<span class="em">${esc(e)}</span>`).join("")}</div>`;
    const script = `      tl.fromTo("#intro-title .word", { opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out", stagger: 0.09 }, 0.5);
      tl.fromTo("#intro-sub", { opacity: 0, filter: "blur(8px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(subAt)});
      tl.fromTo("#intro-today .em", { opacity: 0, y: 24, scale: 0.7 },
        { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.6)", stagger: 0.3 }, ${r3(subAt + 0.6)});
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
      // A pair without `repeat` is only explained: no "say it with me" line or card.
      const vRepeat = pair.repeat ? await voice(pair.repeat) : null;
      const at = t;
      const sayAt = at + 0.2;
      const repeatAt = sayAt + vSay.seconds + 0.4;
      const leaveAt = vRepeat
        ? repeatAt + vRepeat.seconds + 1.4 // a beat for the class to say it back
        : sayAt + vSay.seconds + 1.2;
      placeVoice(vSay, start + sayAt);
      if (vRepeat) placeVoice(vRepeat, start + repeatAt);
      // Quiet moment: Tommy has finished (and the class is still saying the word); the pair leaves
      // 0.5 s after the video resumes.
      breaks.push(r3(start + leaveAt - 0.5));
      parts.push(`    <div id="${id}-pair${i}" class="pair">
      <div id="${id}-animal${i}" class="animal">${esc(pair.emoji)}</div>
      <div id="${id}-arrow${i}" class="arrow"></div>
      <div id="${id}-home${i}" class="home">${esc(pair.home)}</div>
    </div>
    <p id="${id}-sentence${i}" class="sentence">${esc(pair.sentence)}</p>${vRepeat ? `
    <p id="${id}-say${i}" class="say">${L.sayWithMe(esc(pair.home))}</p>` : ""}`);
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
${vRepeat ? `      tl.fromTo("#${id}-say${i}", { opacity: 0, scale: 0.8 },
        { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.6)" }, ${r3(repeatAt)});
` : ""}      tl.to(["#${id}-pair${i}", "#${id}-sentence${i}"${vRepeat ? `, "#${id}-say${i}"` : ""}],
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

  async function quizScene(start, scene, n) {
    const id = `quiz${n}`;
    const vAsk = await voice(scene.ask);
    const vReveal = await voice(scene.reveal);
    // With a clip the class listens first: Tommy's short `intro` ("listen to this"), the clip, and
    // only then the question and options, which Tommy asks. Without one he asks straight away.
    const vIntro = scene.clip && scene.intro ? await voice(scene.intro) : null;
    const clipAt = scene.clip ? 0.6 + (vIntro ? vIntro.seconds + 0.3 : 0.4) : 0;
    const askAt = scene.clip ? clipAt + scene.clip.seconds + 0.6 : 0.5;
    const pauseAt = Math.max(2.9, askAt + vAsk.seconds + 0.3); // the page pauses here
    const showAt = scene.clip ? askAt : 0; // when the question and options come on
    const revealAt = pauseAt + 1.0;
    // A reveal video (e.g. the ad itself) plays once Tommy has given the answer; the results pause
    // comes after it, so the class sees the ad before how they did.
    const videoAt = revealAt + 0.1 + vReveal.seconds + 0.6;
    const end = scene.revealVideo ? videoAt + scene.revealVideo.seconds + 0.8 : revealAt + 0.1 + vReveal.seconds + 1.4;
    if (scene.revealVideo) {
      revealVideos.push({ id: `reveal-video-${n}`, file: await media(scene.revealVideo.src), at: r3(start + videoAt),
        seconds: scene.revealVideo.seconds, from: scene.revealVideo.from });
    }
    if (vIntro) placeVoice(vIntro, start + 0.6);
    placeVoice(vAsk, start + askAt);
    placeVoice(vReveal, start + revealAt + 0.1);
    audioClips.push({ id: `sfx-correct-${n}`, file: "assets/correct.mp3", at: r3(start + revealAt + 0.03), seconds: 2, volume: 0.7, track: 4 });
    if (scene.clip) {
      audioClips.push({ id: `clip-${n}`, file: await media(scene.clip.src), at: r3(start + clipAt), seconds: scene.clip.seconds,
        from: scene.clip.from, fade: true, track: 5 });
    }
    // A picture or a clip puts a media panel on the left and the options in one column beside it.
    const withMedia = Boolean(scene.image || scene.clip);
    const panel = !withMedia ? "" : scene.image
      ? `    <div id="${id}-media" class="quiz-media"><img src="${esc(await media(scene.image))}" alt="" /></div>\n`
      : `    <div id="${id}-media" class="quiz-media quiz-record"><div class="vinyl"><span class="vinyl-label"></span></div><span class="tonearm-base"></span><span class="tonearm"></span></div>\n`;
    const listen = scene.clip ? `    <p id="${id}-listen" class="listen-chip">${L.listen}</p>\n` : "";
    const opts = scene.options.map((o, i) => `      <div id="${id}-opt${i}" class="opt ${withMedia ? "opt-sm" : optSize(o)}"><span class="letter">${LETTERS[i]}</span><span class="opt-text">${esc(o)}</span><span id="${id}-tick${i}" class="tick">✓</span></div>`).join("\n");
    const body = `    <div id="${id}-tag" class="quiz-tag">${L.question(n)}</div>
    <h2 id="${id}-q" class="quiz-q${withMedia || optWeight(scene.q) > 18 ? " quiz-q-short" : ""}">${words(scene.q.split(" "), -1)}</h2>
${panel}${listen}    <div id="${id}-options" class="options${withMedia ? " options-beside" : ""}" data-hold>
${opts}
    </div>
    <p id="${id}-hint" class="phone-hint">${L.answerOnPhone}</p>
    <p id="${id}-answer" class="answer-line">${esc(scene.line)}</p>${scene.revealVideo ? `
    <div id="${id}-adtag" class="quiz-tag">${L.adTag}</div>` : ""}`;
    const dim = scene.options.map((_, i) => i).filter((i) => i !== scene.correct)
      .map((i) => `      tl.to("#${id}-opt${i}", { opacity: 0.3, duration: 0.3, ease: "power2.out" }, ${r3(revealAt)});`).join("\n");
    const script = `      tl.fromTo("#${id}-tag", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)" }, 0.2);
      tl.fromTo("#${id}-q .word", { opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out", stagger: 0.08 }, ${r3(showAt + 0.5)});
      tl.fromTo("#${id}-options .opt", { opacity: 0, y: 30, filter: "blur(8px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out", stagger: 0.07 }, ${r3(showAt + 1.4)});
${withMedia ? (scene.clip
        // The turntable sits big in the middle while the song plays (there is no question yet),
        // then slides left to its place beside the question and the options.
        ? `      tl.fromTo("#${id}-media", { opacity: 0, scale: 1.24, x: 430, y: 20 }, { opacity: 1, scale: 1.3, x: 430, y: 20, duration: 0.5, ease: "expo.out" }, 0.4);
      tl.to("#${id}-media", { scale: 1, x: 0, y: 0, duration: 0.8, ease: "power3.inOut" }, ${r3(clipAt + scene.clip.seconds + 0.2)});\n`
        : `      tl.fromTo("#${id}-media", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }, 1.2);\n`) : ""}${scene.clip ? `      tl.fromTo("#${id}-listen", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, ${r3(Math.max(0.5, clipAt - 0.2))});
      tl.to("#${id}-listen", { opacity: 0, duration: 0.2, ease: "power2.in" }, ${r3(clipAt + scene.clip.seconds)});
      // Like a real record player: the arm swings onto the record, the record turns while the song
      // plays, then the arm lifts off and the record slows to a stop.
      tl.fromTo("#${id}-media .tonearm", { rotation: 14 }, { rotation: 47, transformOrigin: "9px 0px", duration: 0.7, ease: "power2.inOut" }, ${r3(Math.max(0.5, clipAt - 0.8))});
      tl.fromTo("#${id}-media .vinyl", { rotation: 0 }, { rotation: ${Math.round(scene.clip.seconds * 200)}, duration: ${scene.clip.seconds}, ease: "none" }, ${r3(clipAt)});
      tl.to("#${id}-media .vinyl", { rotation: ${Math.round(scene.clip.seconds * 200) + 150}, duration: 1, ease: "power2.out" }, ${r3(clipAt + scene.clip.seconds)});
      tl.to("#${id}-media .tonearm", { rotation: 14, transformOrigin: "9px 0px", duration: 0.6, ease: "power2.inOut" }, ${r3(clipAt + scene.clip.seconds)});
` : ""}      tl.fromTo("#${id}-hint", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${scene.clip ? r3(pauseAt - 0.3) : 2.3});
      // Paused at ${r3(pauseAt)} s while the class answers; the reveal starts at ${r3(revealAt)} s.
      tl.to("#${id}-hint", { opacity: 0, filter: "blur(8px)", duration: 0.15, ease: "power3.in" }, ${r3(revealAt - 0.4)});
${dim}
      tl.set("#${id}-opt${scene.correct}", { className: "opt correct-bg" }, ${r3(revealAt)});
      tl.fromTo("#${id}-opt${scene.correct}", { scale: 1 }, { scale: 1.04, duration: 0.25, ease: "power2.out" }, ${r3(revealAt)});
      tl.to("#${id}-opt${scene.correct}", { scale: 1, duration: 0.35, ease: "power2.inOut" }, ${r3(revealAt + 0.25)});
      tl.fromTo("#${id}-tick${scene.correct}", { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.8)" }, ${r3(revealAt + 0.05)});
      tl.fromTo("#${id}-answer", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(revealAt + 0.8)});
${scene.revealVideo ? `      // The reveal video takes the screen at ${r3(videoAt)} s (the root timeline shows it).
      tl.to(["#${id}-tag", "#${id}-q", "#${id}-options", "#${id}-answer"${withMedia ? `, "#${id}-media"` : ""}], { opacity: 0, duration: 0.3, ease: "power2.in" }, ${r3(videoAt - 0.4)});
      tl.fromTo("#${id}-adtag", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.6)" }, ${r3(videoAt - 0.1)});
` : ""}      tl.to(["#${id}-tag", "#${id}-q", "#${id}-options", "#${id}-answer"${withMedia ? `, "#${id}-media"` : ""}${scene.revealVideo ? `, "#${id}-adtag"` : ""}], { opacity: 0, filter: "blur(10px)", duration: 0.25, ease: "power3.in" }, ${r3(end - 0.35)});`;
    // The wrong-answer lines, keyed by the option's index (the page counts picks by index).
    const wrong = {};
    for (const [text, lines] of Object.entries(scene.wrongLines || {})) {
      const index = scene.options.indexOf(text);
      if (index < 0 || index === scene.correct) throw new Error(`wrongLines "${text}" is not a wrong option of "${scene.q}"`);
      wrong[index] = await clips(`q${n}-wrong-${index + 1}`, lines);
    }
    // When the options appear on the big screen: the phones show the question and answers (view only)
    // from here, while Tommy is still reading them, and the answers open when the page pauses.
    const previewAt = showAt + 1.4 < pauseAt - 0.4 ? r3(start + showAt + 1.4) : null;
    const cue = {
      at: r3(start + pauseAt),
      resumeAt: r3(start + pauseAt),
      ...(previewAt != null ? { previewAt } : {}),
      // Where the page pauses again for the results: the answer has been revealed and the scene is
      // about to fade out, so the next scene still follows on from this one.
      result: { at: r3(start + end - 0.5), key: `q${n}`, wrong },
      exercise: {
        id: `autoclass-${lesson.id}-q${n}`,
        type: "mcquiz",
        title: `${lesson.title} · ${L.question(n)}`,
        items: [{
          title: scene.q,
          timeLimit: scene.timeLimit || 20,
          ...(scene.image ? { image: scene.image } : {}),
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
    const body = `    <div id="${id}-tag" class="quiz-tag">${L.speakTag}</div>
    <div id="${id}-emoji" class="say-emoji">${esc(scene.emoji || "🎤")}</div>
    <h2 id="${id}-line" class="say-line">${words(scene.sentence.split(" "), -1)}</h2>
    <p id="${id}-hint" class="phone-hint">${L.speakHint}</p>
    <p id="${id}-done" class="answer-line">${L.wellDone}</p>`;
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

  // An open question. The page pauses at `at` while every phone answers out loud (Everyone Answers,
  // marked by the model against `answer`), plays on into Tommy giving a good answer, and pauses again
  // at `result.at` for how the class did. Each answer's verdict (correct, partial, incorrect) counts
  // as option 0, 1 or 2 of a three-option question, so the results page and the analysis picker work
  // as they do for a quiz.
  async function askScene(start, scene, n) {
    const id = `ask${n}`;
    const vAsk = await voice(scene.ask);
    const vReveal = await voice(scene.reveal);
    // A warm-up keeps it short: no answer card after the pause, just Tommy's line, and on.
    const warm = Boolean(scene.warmup);
    // A sharing question (open) has no right answer: no answer card either, but it keeps the normal pace.
    const unmarked = warm || Boolean(scene.open);
    const askAt = 0.5;
    const pauseAt = Math.max(2.4, askAt + vAsk.seconds + 0.3);
    const revealAt = pauseAt + (warm ? 0.5 : 0.8);
    const end = revealAt + vReveal.seconds + (warm ? 0.9 : 1.6);
    placeVoice(vAsk, start + askAt);
    placeVoice(vReveal, start + revealAt);
    const body = `    <div id="${id}-tag" class="quiz-tag">${warm ? L.warmupTag : scene.open ? L.shareTag : L.askTag}</div>
    <h2 id="${id}-q" class="quiz-q">${words(scene.q.split(" "), -1)}</h2>
    <div id="${id}-emoji" class="ask-emoji">${esc(scene.emoji || "💬")}</div>
${unmarked ? "" : `    <div id="${id}-answer" class="ask-answer">${esc(scene.answer)}</div>\n`}    <p id="${id}-hint" class="phone-hint">${L.askHint}</p>`;
    const script = `      tl.fromTo("#${id}-tag", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)" }, 0.2);
      tl.fromTo("#${id}-q .word", { opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out", stagger: 0.08 }, 0.5);
      tl.fromTo("#${id}-emoji", { opacity: 0, scale: 0.6, filter: "blur(10px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "back.out(1.4)" }, 1.0);
      tl.fromTo("#${id}-hint", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(pauseAt - 0.6)});
      // Paused at ${r3(pauseAt)} s while the class answers; Tommy gives a good answer from ${r3(revealAt)} s.
      tl.to(["#${id}-hint", "#${id}-emoji"], { opacity: 0, filter: "blur(8px)", duration: 0.2, ease: "power3.in" }, ${r3(revealAt - 0.4)});
${unmarked ? "" : `      tl.fromTo("#${id}-answer", { opacity: 0, y: 30, filter: "blur(8px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, ${r3(revealAt)});
`}      tl.to(["#${id}-tag", "#${id}-q"${unmarked ? "" : `, "#${id}-answer"`}], { opacity: 0, filter: "blur(10px)", duration: 0.25, ease: "power3.in" }, ${r3(end - 0.35)});`;
    const css = `
    .ask-emoji {
      position: absolute;
      left: 0;
      right: 0;
      top: 400px;
      text-align: center;
      font-size: 220px;
    }
    .ask-answer {
      position: absolute;
      left: 150px;
      right: 150px;
      top: 430px;
      padding: 44px 56px;
      border-radius: 36px;
      background: var(--teal-soft);
      border: 4px solid var(--teal);
      color: var(--teal);
      font-size: 60px;
      font-weight: 900;
      line-height: 1.3;
      text-align: center;
      /* Even lines, so a long answer never leaves one character alone on the last line. */
      text-wrap: balance;
    }`;
    const cue = {
      at: r3(start + pauseAt),
      resumeAt: r3(start + pauseAt),
      ask: { question: scene.q, answer: scene.answer, seconds: scene.seconds || 30, ...(warm ? { warmup: true, tag: L.warmupTag } : {}), ...(scene.open && !warm ? { open: true, tag: L.shareTag } : {}) },
      result: { at: r3(start + end - 0.5), key: id, wrong: {} },
      exercise: {
        id: `autoclass-${lesson.id}-${id}`,
        type: "openanswer",
        autoclass: true,
        title: `${lesson.title} · ${scene.q}`,
        items: [{ topic: scene.q, correctAnswer: scene.answer, sttLanguage: lesson.tutor?.sttLanguage || "en", timeLimit: scene.seconds || 30 }],
      },
    };
    return { id, duration: r3(end), html: sceneFile(id, body, script, css), tommy: "hidden", cue };
  }

  // A spelling race. Tommy asks, the words' emojis come in with a blank for each letter, and the
  // page pauses at `at` while every phone spells (worker/room-spell.js). It plays on into the words
  // being written in while Tommy says `reveal`, and pauses again at `result.at` for how the class did.
  async function spellScene(start, scene, n) {
    const id = `spell${n}`;
    const vAsk = await voice(scene.ask);
    const vReveal = await voice(scene.reveal);
    const count = scene.words.length;
    const askAt = 0.5;
    const cardsAt = 0.9;
    const pauseAt = Math.max(askAt + vAsk.seconds + 0.3, cardsAt + count * 0.12 + 0.8);
    const revealAt = pauseAt + 0.8;
    const end = revealAt + Math.max(vReveal.seconds, count * 0.18 + 1.2) + 1.6;
    placeVoice(vAsk, start + askAt);
    placeVoice(vReveal, start + revealAt);
    // Four to a row; fewer words get bigger cards.
    const cols = count <= 3 ? count : count === 4 ? 4 : count <= 6 ? 3 : 4;
    const size = count <= 4 ? "spell-lg" : count <= 8 ? "spell-md" : "spell-sm";
    const cards = scene.words.map((w, i) => `      <div id="${id}-card${i}" class="spell-card">
        <div class="spell-emoji">${esc(w.emoji)}</div>
        <div class="spell-word"><span id="${id}-blank${i}" class="spell-blank">${"_".repeat(w.word.length).split("").join(" ")}</span><span id="${id}-word${i}" class="spell-answer">${esc(w.word)}</span></div>
      </div>`).join("\n");
    const body = `    <div id="${id}-tag" class="quiz-tag">${L.spellTag}</div>
    <div id="${id}-grid" class="spell-grid ${size}" style="--cols: ${cols}">
${cards}
    </div>
    <p id="${id}-hint" class="phone-hint spell-hint">${L.spellHint}</p>`;
    const script = `      tl.fromTo("#${id}-tag", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)" }, 0.2);
      tl.fromTo("#${id}-grid .spell-card", { opacity: 0, y: 30, scale: 0.85, filter: "blur(8px)" },
        { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.5, ease: "back.out(1.4)", stagger: 0.12 }, ${cardsAt});
      tl.fromTo("#${id}-hint", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${r3(pauseAt - 0.6)});
      // Paused at ${r3(pauseAt)} s while the class spells; the words are written in from ${r3(revealAt)} s.
      tl.to("#${id}-hint", { opacity: 0, filter: "blur(8px)", duration: 0.15, ease: "power3.in" }, ${r3(revealAt - 0.4)});
      tl.to("#${id}-grid .spell-blank", { opacity: 0, duration: 0.15, ease: "power2.in", stagger: 0.18 }, ${r3(revealAt)});
      tl.fromTo("#${id}-grid .spell-answer", { opacity: 0, scale: 0.6 },
        { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.8)", stagger: 0.18 }, ${r3(revealAt + 0.1)});
      tl.to(["#${id}-tag", "#${id}-grid"], { opacity: 0, filter: "blur(10px)", duration: 0.25, ease: "power3.in" }, ${r3(end - 0.35)});`;
    const css = `
    .spell-grid {
      position: absolute;
      left: 150px;
      right: 150px;
      top: 210px;
      display: grid;
      grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
      gap: 28px;
      justify-content: center;
    }
    .spell-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 18px 12px 22px;
      border-radius: 32px;
      background: var(--cream);
      box-shadow: 0 10px 0 var(--page-deep);
    }
    .spell-word {
      display: grid;
      place-items: center;
      font-weight: 900;
      color: var(--purple-deep);
      white-space: nowrap;
    }
    .spell-blank,
    .spell-answer {
      grid-area: 1 / 1;
    }
    .spell-blank {
      color: var(--muted);
      letter-spacing: 0.04em;
    }
    .spell-answer {
      opacity: 0;
    }
    .spell-grid.spell-lg { top: 290px; }
    .spell-lg .spell-emoji { font-size: 170px; }
    .spell-lg .spell-word { font-size: 72px; }
    .spell-md .spell-emoji { font-size: 110px; }
    .spell-md .spell-word { font-size: 54px; }
    .spell-sm .spell-emoji { font-size: 84px; }
    .spell-sm .spell-word { font-size: 44px; }
    .spell-sm .spell-card { padding: 10px 10px 14px; }
    .spell-hint {
      top: 940px;
    }`;
    const cue = {
      at: r3(start + pauseAt),
      resumeAt: r3(start + pauseAt),
      spell: {
        id: `autoclass-${lesson.id}-${id}`,
        seconds: scene.seconds || 60,
        words: scene.words.map(({ word, emoji, hint }) => ({ word, emoji, hint })),
      },
      result: { at: r3(start + end - 0.5), key: id, wrong: {} },
      exercise: {
        id: `autoclass-${lesson.id}-${id}`,
        type: "spellrace",
        title: `${lesson.title} · ${L.spellTag}`,
      },
    };
    return { id, duration: r3(end), html: sceneFile(id, body, script, css), tommy: "hidden", cue };
  }

  // A poll pauses the video at `at`, the boundary between two scenes, and resumes from there.
  async function pollCue(at, scene, n) {
    const audio = {};
    for (const [key, name, text] of [["askAudio", "ask", scene.ask], ["doneAudio", "thanks", scene.thanks]]) {
      if (text) audio[key] = await publish(`poll${n}-${name}.mp3`, text);
    }
    return {
      at: r3(at),
      resumeAt: r3(at),
      poll: { id: `autoclass-${lesson.id}-poll${n}`, question: scene.q, options: scene.options, seconds: scene.seconds || 20, ...audio },
    };
  }

  // What the page needs to answer a student's question. The live Tommy it shows is the same talking
  // clip as the video's, placed exactly where the small Tommy is, so the answer card grows out of
  // him instead of cutting in.
  async function tutorBlock(scenes) {
    const t = lesson.tutor;
    const lines = { leadIns: [], leadOuts: [] };
    for (const [i, text] of t.leadIns.entries()) lines.leadIns.push(await publish(`tutor-in${i + 1}.mp3`, text));
    for (const [i, text] of t.leadOuts.entries()) lines.leadOuts.push(await publish(`tutor-out${i + 1}.mp3`, text));
    copyFileSync(path.join(dir, "assets", "tommy-talking.webm"), path.join(OUT, "tommy-talking.webm"));
    const small = TOMMY_POS.small;
    return {
      enabled: t.enabled !== false,
      maxAnswers: t.maxAnswers,
      language: t.language,
      sttLanguage: t.sttLanguage,
      outline: t.outline,
      audience: t.audience || "",
      tommyVideo: `${mediaUrl}/tommy-talking.webm`,
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
    const rows = lesson.outro.rows.map(([e, word, link, hl]) =>
      `      <div class="recap-row"><span class="em">${esc(e)}</span><span>${esc(word)}</span>${link ? `<span class="to">${esc(link)}</span>` : ""}<span class="h">${esc(hl)}</span></div>`).join("\n");
    // Each recap row lands as Tommy says it: spread across the middle of his line.
    const rowStart = 0.5 + v.seconds * 0.22;
    const rowStep = (v.seconds * 0.6) / lesson.outro.rows.length;
    const body = `    <h2 id="outro-title"><span class="word">${L.outroTitle[0]}</span><span class="word hl">${L.outroTitle[1]}</span></h2>
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

  for (const sub of ["compositions", "assets", "out/analysis"]) mkdirSync(path.join(dir, sub), { recursive: true });
  for (const file of ["lesson.css", "correct.mp3"]) copyFileSync(path.join(ASSETS, file), path.join(dir, "assets", file));
  copyFileSync(TOMMY_SOURCE, path.join(dir, "assets", "tommy-talking.webm"));

  const scenes = [];
  let t = 0;
  const push = (s) => {
    s.start = r3(t);
    scenes.push(s);
    t += s.duration;
  };
  push(await introScene(t));
  const count = { teach: 0, quiz: 0, speak: 0, ask: 0, spell: 0 };
  const pollCues = [];
  for (const scene of lesson.scenes) {
    if (scene.kind === "teach") push(await teachScene(t, scene, ++count.teach));
    else if (scene.kind === "poll") pollCues.push(await pollCue(t, scene, pollCues.length + 1));
    else if (scene.kind === "speak") push(await speakScene(t, scene, ++count.speak));
    else if (scene.kind === "ask") push(await askScene(t, scene, ++count.ask));
    else if (scene.kind === "quiz") push(await quizScene(t, scene, ++count.quiz));
    else if (scene.kind === "spell") push(await spellScene(t, scene, ++count.spell));
    else throw new Error(`Unknown scene kind "${scene.kind}".`);
  }
  push(await outroScene(t));
  const total = r3(t);

  for (const s of scenes) writeFileSync(path.join(dir, "compositions", `${s.id}.html`), s.html);

  const hosts = scenes.map((s) => `      <div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html"
        data-start="${s.start}" data-duration="${s.duration}" data-track-index="1" data-track-kind="graphics"
        data-width="1920" data-height="1080" style="z-index: 1"></div>`).join("\n");
  const tommyClips = [];
  for (let at = 0, n = 1; at < total; at += TOMMY_LOOP, n += 1) {
    tommyClips.push(`        <video id="tommy-${n}" class="clip" src="assets/tommy-talking.webm" data-start="${r3(at)}" data-duration="${r3(Math.min(TOMMY_LOOP, total - at))}" data-track-index="2" muted playsinline></video>`);
  }
  const audio = audioClips.map((a) => `      <audio id="${a.id}" class="clip" src="${a.file}" data-start="${a.at}" data-duration="${a.seconds}"
        data-track-index="${a.track ?? 3}" data-volume="${a.volume ?? 1}"${a.from ? ` data-media-start="${a.from}"` : ""}${a.fade ? ' data-fade-in="0.3" data-fade-out="1"' : ""}></audio>`).join("\n");
  const videos = revealVideos.map((v) => `      <video id="${v.id}" class="clip reveal-video" src="${v.file}" data-start="${v.at}" data-duration="${v.seconds}"
        data-track-index="6"${v.from ? ` data-media-start="${v.from}"` : ""} data-has-audio="true" data-fade-in="0.3" data-fade-out="0.8" playsinline style="z-index: 4"></video>`).join("\n");
  const videoFades = revealVideos.map((v) => `      tl.fromTo("#${v.id}", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, ${v.at});
      tl.to("#${v.id}", { opacity: 0, duration: 0.35, ease: "power2.in" }, ${r3(v.at + v.seconds - 0.35)});`).join("\n");
  const first = TOMMY_POS[scenes[0].tommy];
  const moves = [];
  for (let i = 1; i < scenes.length; i += 1) {
    if (scenes[i].tommy === scenes[i - 1].tommy) continue;
    const p = TOMMY_POS[scenes[i].tommy];
    const at = scenes[i].start - (p.opacity === 0 ? 0.3 : 0.1);
    moves.push(`      tl.to("#tommy", { x: ${p.x}, y: ${p.y}, scale: ${p.scale}, opacity: ${p.opacity}, duration: 0.6, ease: "power2.inOut" }, ${r3(Math.max(0, at))});`);
  }

  writeFileSync(path.join(dir, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <!-- Written from the lesson script by video-container/autoclass/lesson.mjs: edit the script and
         rebuild, or the cues will drift from the video. -->
    <style>
${readFileSync(path.join(ASSETS, "lesson.css"), "utf8").replace(/^/gm, "      ").trimEnd()}
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

${videos}

${audio}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#tommy", { x: ${first.x + 160}, y: ${first.y}, scale: ${first.scale}, opacity: 0 },
        { x: ${first.x}, y: ${first.y}, scale: ${first.scale}, opacity: 1, duration: 0.8, ease: "expo.out" }, 0.2);
${moves.join("\n")}
${videoFades}
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
    lessonId: lesson.id,
    theme: lesson.theme || "",
    video: `${mediaUrl}/${lesson.id}.mp4`, // render into out/<id>.mp4
    source: "video-container/autoclass/lesson.mjs, from the lesson script (do not edit by hand)",
    duration: total,
    cues: [...scenes.filter((s) => s.cue).map((s) => s.cue), ...pollCues].sort((a, b) => a.at - b.at),
    tutor,
    analysis,
    speakAnalysis,
  };
  writeFileSync(path.join(OUT, "cues.json"), `${JSON.stringify(cues, null, 2)}\n`);
  return { total, cues, scenes: scenes.map(({ id, start, duration, cue, breaks }) => ({ id, start, duration, pauseAt: cue?.at, breaks })) };
}
