// Writes a HyperFrames project (index.html + compositions/*.html) for one
// lecture plan, following Uncle toomy vrm's tools/build.mjs in "gif" mode:
// the talking Tommy loop, no lip-sync, no stock footage.
// Without word timings from the voice, a cue's time is its place in the
// narration scaled to the clip length.
import fs from "node:fs";
import path from "node:path";
import { KIT_CSS, SCENE_CSS } from "./slide-css.mjs";

const r3 = (n) => Math.round(n * 1000) / 1000;
const LEAD = 0.35;
const INTRO_LEAD = 0.9;
const TAIL = 0.75;
const TOMMY_LOOP_SECONDS = 40; // assets/tommy-talking.webm
const MARKERS = ["mk-ring", "mk-plus", "mk-ring", "mk-diamond"];
const PILLS = ["p-pu", "p-ma", "p-te", "p-go"];

const STYLES = {
  up: [{ opacity: 0, y: 28, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.6, ease: "expo.out" }],
  blur: [{ opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.35, ease: "power4.out" }],
  pop: [{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.8)" }],
  out: [{ opacity: 1, y: 0, filter: "blur(0px)" }, { opacity: 0, y: -18, filter: "blur(8px)", duration: 0.3, ease: "power3.in", immediateRender: false }],
};

const EXTRA_CSS = `
  .left .li { font-size: 38px; }
  .left .big { font-size: 80px; }
  .body { max-height: 740px; }
  .say .bub { max-width: 1000px; }
  .sides .card { flex: 1; font-size: 34px; }
  .note { font-size: 34px; }
`;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Escaped text with **bold** turned into <b>.
function rich(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
}

function highlightTitle(title, highlight) {
  const html = rich(title);
  const mark = escapeHtml(highlight || "");
  if (!mark || !html.includes(mark)) return html;
  return html.replace(mark, `<span class="pu">${mark}</span>`);
}

const li = (id, mk, html) => `<div class="li" id="${id}"><span class="mk ${mk}"></span><div class="lt">${html}</div></div>`;
const pill = (id, text, cls) => `<span class="pill ${cls}" id="${id}">${text}</span>`;
function say(id, who, text) {
  const key = String(who || "").toLowerCase();
  const cls = key === "guest" ? "guest" : key === "you" ? "you" : "lab";
  return `<div class="say ${cls}" id="${id}"><span class="who">${escapeHtml(who || "You")}</span><div class="bub">&ldquo;${rich(text)}&rdquo;</div></div>`;
}

// Seconds into a narration where each cue is spoken, kept in order. A cue the
// narration does not contain falls between its neighbours.
export function cueTimes(narration, cues, voiceSeconds) {
  const text = narration.toLowerCase();
  const length = Math.max(1, text.length);
  let from = 0;
  const found = cues.map((cue) => {
    const phrase = String(cue || "").toLowerCase().replace(/\*\*/g, "").trim();
    const idx = phrase ? text.indexOf(phrase, from) : -1;
    if (idx < 0) return null;
    from = idx + 1;
    return (idx / length) * voiceSeconds;
  });
  const times = [];
  for (let i = 0; i < found.length; i++) {
    if (found[i] != null) {
      times.push(found[i]);
      continue;
    }
    const prev = times[i - 1] ?? 0;
    let next = voiceSeconds * 0.9;
    for (let j = i + 1; j < found.length; j++) {
      if (found[j] != null) {
        next = found[j];
        break;
      }
    }
    times.push(prev + (next - prev) / 2);
  }
  for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + 0.25);
  return times.map((t) => Math.min(t, Math.max(0, voiceSeconds - 0.4)));
}

function introScene(plan) {
  const { intro, eyebrow } = plan;
  const points = intro.points.map((p, i) => li(`intro-b${i}`, MARKERS[i % MARKERS.length], rich(p.text))).join("\n      ");
  return {
    id: "intro",
    layout: "A",
    lead: INTRO_LEAD,
    narration: intro.narration,
    html: `
    <div class="left" id="intro-g1">
      <div class="eyebrow" id="intro-eb">${escapeHtml(eyebrow)}</div>
      <h1 class="big" id="intro-title">${highlightTitle(intro.title, intro.highlight)}</h1>
      ${points}
    </div>`,
    fixed: [
      ["#intro-eb", 0.2, "up"],
      ["#intro-title", 0.45, "blur"],
    ],
    cued: intro.points.map((p, i) => [`#intro-b${i}`, p.cue, "up"]),
  };
}

function outroScene(plan) {
  const { outro } = plan;
  const points = outro.points.map((p, i) => li(`outro-b${i}`, MARKERS[i % MARKERS.length], rich(p.text))).join("\n      ");
  return {
    id: "outro",
    layout: "A",
    lead: LEAD,
    narration: outro.narration,
    html: `
    <div class="left" id="outro-g">
      <h1 class="big" id="outro-title">${rich(outro.title)}</h1>
      ${points}
      <div class="bye" id="outro-bye">${rich(outro.bye)}</div>
    </div>`,
    fixed: [["#outro-title", 0.3, "blur"]],
    cued: [...outro.points.map((p, i) => [`#outro-b${i}`, p.cue, "up"]), ["#outro-bye", "", "pop"]],
  };
}

function contentScene(scene, index) {
  const id = `s${index + 1}`;
  const parts = [];
  const cued = [];
  scene.blocks.forEach((block, b) => {
    const bid = `${id}-b${b}`;
    if (block.type === "say") {
      parts.push(say(bid, block.who, block.text));
      cued.push([`#${bid}`, block.cue, "up"]);
    } else if (block.type === "note") {
      parts.push(`<div class="note" id="${bid}">${rich(block.text)}</div>`);
      cued.push([`#${bid}`, block.cue, "up"]);
    } else if (block.type === "pills") {
      parts.push(`<div class="row" id="${bid}">${block.items.map((item, i) => pill(`${bid}-${i}`, rich(item.text), PILLS[i % PILLS.length])).join("")}</div>`);
      block.items.forEach((item, i) => cued.push([`#${bid}-${i}`, item.cue, "pop"]));
    } else if (block.type === "cards") {
      parts.push(
        `<div class="sides">${block.items
          .map((item, i) => `<div class="card side" id="${bid}-${i}">${item.tag ? `<div class="tag">${escapeHtml(item.tag)}</div>` : ""}<span class="q">${rich(item.text)}</span></div>`)
          .join("")}</div>`
      );
      block.items.forEach((item, i) => cued.push([`#${bid}-${i}`, item.cue, "up"]));
    } else {
      parts.push(li(bid, MARKERS[b % MARKERS.length], rich(block.text)));
      cued.push([`#${bid}`, block.cue, "up"]);
    }
  });
  return {
    id,
    layout: "B",
    lead: LEAD,
    title: rich(scene.title),
    narration: scene.narration,
    html: `\n    ${parts.join("\n    ")}`,
    fixed: [],
    cued,
  };
}

export function lectureScenes(plan) {
  return [introScene(plan), ...plan.scenes.map(contentScene), outroScene(plan)];
}

// voices: { [sceneId]: seconds }. Writes the project into dir.
export function writeProject(dir, plan, voices) {
  fs.mkdirSync(path.join(dir, "compositions"), { recursive: true });
  let t = 0;
  const timed = lectureScenes(plan).map((s) => {
    const voice = voices[s.id];
    const dur = r3(s.lead + voice + TAIL);
    const out = { ...s, voice, start: r3(t), dur };
    t += dur;
    return out;
  });
  const TOTAL = r3(t);

  for (const s of timed) {
    const tweens = [];
    if (s.title) tweens.push(`tl.fromTo("#${s.id}-title", ${JSON.stringify(STYLES.blur[0])}, ${JSON.stringify(STYLES.blur[1])}, 0.2);`);
    for (const [sel, at, style] of s.fixed) {
      tweens.push(`tl.fromTo("${sel}", ${JSON.stringify(STYLES[style][0])}, ${JSON.stringify(STYLES[style][1])}, ${at});`);
    }
    const times = cueTimes(s.narration, s.cued.map(([, cue]) => cue), s.voice);
    s.cued.forEach(([sel, , style], i) => {
      const at = r3(Math.max(0.1, s.lead + times[i] - 0.08));
      tweens.push(`tl.fromTo("${sel}", ${JSON.stringify(STYLES[style][0])}, ${JSON.stringify(STYLES[style][1])}, ${at});`);
    });
    if (s.id !== timed[timed.length - 1].id) {
      tweens.push(`tl.fromTo("#${s.id}-content", ${JSON.stringify(STYLES.out[0])}, ${JSON.stringify(STYLES.out[1])}, ${r3(s.dur - 0.4)});`);
    }
    const body = s.layout === "B" ? `<h1 class="title" id="${s.id}-title">${s.title}</h1>\n    <div class="body">${s.html}\n    </div>` : s.html;
    fs.writeFileSync(
      path.join(dir, "compositions", `${s.id}.html`),
      `<template>
  <style>${SCENE_CSS}${KIT_CSS}${EXTRA_CSS}</style>
  <div id="root" data-composition-id="${s.id}" data-width="1920" data-height="1080">
    <div class="content" id="${s.id}-content">
    ${body}
    </div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${tweens.join("\n    ")}
    window.__timelines["${s.id}"] = tl;
  </script>
</template>
`
    );
  }

  const hosts = timed
    .map(
      (s) =>
        `      <div id="${s.id}" class="scene" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.dur}" data-track-index="3" data-track-kind="graphics" data-width="1920" data-height="1080"></div>`
    )
    .join("\n");
  const voiceClips = timed
    .map((s) => `      <audio id="vo-${s.id}" class="clip" src="assets/voice/${s.id}.mp3" data-start="${r3(s.start + s.lead)}" data-duration="${r3(s.voice)}" data-track-index="4" data-volume="1"></audio>`)
    .join("\n");
  // The talking loop is 40 s, so longer stretches chain several copies.
  const tommyClips = [];
  for (let at = 0, n = 0; at < TOTAL - 0.001; at += TOMMY_LOOP_SECONDS, n++) {
    const dur = r3(Math.min(TOMMY_LOOP_SECONDS, TOTAL - at));
    tommyClips.push(
      `            <video id="tommy-${n}" class="clip tommy-vid" src="assets/tommy-talking.webm" data-start="${r3(at)}" data-duration="${dur}" data-track-index="2" muted playsinline></video>`
    );
  }

  const POS = {
    tommy: { A: { x: 0, y: 0, scale: 1 }, B: { x: 230, y: 290, scale: 0.48 } },
    "tommy-deco": { A: { opacity: 1 }, B: { opacity: 0 } },
    blob: { A: { opacity: 0 }, B: { opacity: 1 } },
    "ring-pu": { A: { x: 0, y: 0 }, B: { x: 820, y: 770 } },
    "ring-ye": { A: { x: 0, y: 0 }, B: { x: 520, y: -150 } },
    "ring-te": { A: { x: 0, y: 0 }, B: { x: 620, y: -40 } },
    "ring-bl": { A: { x: 0, y: 0, opacity: 0 }, B: { x: 0, y: 0, opacity: 1 } },
  };
  const rootTweens = [];
  for (let i = 1; i < timed.length; i++) {
    const from = timed[i - 1].layout;
    const to = timed[i].layout;
    if (from === to) continue;
    const at = r3(timed[i].start - 0.45);
    for (const [el, st] of Object.entries(POS)) {
      rootTweens.push(`tl.fromTo("#${el}", ${JSON.stringify(st[from])}, ${JSON.stringify({ ...st[to], duration: 0.9, ease: "power2.inOut", immediateRender: false })}, ${at});`);
    }
  }
  rootTweens.push(`tl.fromTo("#bg-ground", { opacity: 1 }, { opacity: 1, duration: ${TOTAL} }, 0);`);

  const BLOB = "M 420 30 C 600 22 742 150 732 330 C 722 520 600 690 400 696 C 212 702 48 600 40 420 C 32 250 120 118 262 70 C 312 52 362 33 420 30 Z";
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #fdfdfe; }
      #root { width: 100%; height: 100%; position: relative; font-family: "Nunito", sans-serif; }
      #bg-ground { position: absolute; inset: 0; background: #fdfdfe; z-index: 0; }
      #blob { position: absolute; inset: 0; opacity: 0; }
      .ring { position: absolute; border-radius: 50%; }
      #ring-pu { left: 96px; top: 86px; width: 72px; height: 72px; border: 18px solid #c4a1f2; }
      #ring-ye { left: 1050px; top: 236px; width: 42px; height: 42px; border: 10px solid #f6cf5b; }
      #ring-te { left: 670px; top: 948px; width: 30px; height: 30px; border: 7px solid #46b9b0; }
      #ring-bl { left: 1770px; top: 470px; width: 76px; height: 76px; border: 18px solid #4aa3f0; opacity: 0; }
      #logo { position: absolute; left: 120px; top: 862px; width: 190px; height: auto; }
      #tommy { position: absolute; left: 1080px; top: 190px; width: 760px; height: 720px; z-index: 1; transform-origin: 50% 50%; }
      #tommy-deco { position: absolute; inset: 0; }
      .pillshape { position: absolute; border-radius: 999px; }
      #pill-pu { left: -150px; top: 430px; width: 360px; height: 74px; background: #9b7bc0; transform: rotate(-18deg); }
      #pill-ye { left: -40px; top: 545px; width: 120px; height: 62px; background: #f6cf5b; transform: rotate(-18deg); }
      #pill-ma { left: 600px; top: 250px; width: 300px; height: 64px; background: #b9568f; transform: rotate(-18deg); }
      #tommy-frame { position: absolute; left: 0; top: 0; width: 760px; height: 720px; clip-path: path("${BLOB}"); background: #dcebfa; }
      .tommy-vid { position: absolute; left: 104px; top: 50px; width: 552px; height: 648px; object-fit: contain; }
      .scene { z-index: 2; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">
      <div id="bg-ground" class="clip" data-start="0" data-duration="${TOTAL}" data-track-index="0" data-layout-ignore>
        <svg id="blob" viewBox="0 0 1920 1080" width="1920" height="1080"><path d="M 760 0 L 1920 0 L 1920 820 C 1800 800 1700 700 1640 600 C 1560 470 1500 420 1360 380 C 1180 330 1060 300 960 200 C 880 120 800 70 760 0 Z" fill="#eef4fc"/></svg>
        <div class="ring" id="ring-pu"></div>
        <div class="ring" id="ring-ye"></div>
        <div class="ring" id="ring-te"></div>
        <div class="ring" id="ring-bl"></div>
        <img id="logo" src="assets/lango-logo.png" alt="Lango" />
      </div>
      <div id="tommy" data-layout-allow-overflow data-layout-allow-occlusion>
        <div id="tommy-deco">
          <div class="pillshape" id="pill-pu"></div>
          <div class="pillshape" id="pill-ye"></div>
          <div class="pillshape" id="pill-ma"></div>
        </div>
        <div id="tommy-frame">
${tommyClips.join("\n")}
        </div>
      </div>
${hosts}
${voiceClips}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${rootTweens.join("\n      ")}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`
  );
  fs.writeFileSync(path.join(dir, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", assets: "assets" }, media: { autoProxy: true } }, null, 2));
  return { total: TOTAL, scenes: timed.map(({ id, start, dur }) => ({ id, start, dur })) };
}
