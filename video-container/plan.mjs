// Turns a lesson script into the Uncle Tommy lecture plan: an intro card, a few
// content slides and an outro, each with the narration Uncle Tommy speaks and
// the on-screen blocks that appear as he says their cue phrase.
// The model writes JSON only; slide HTML comes from fixed templates in build.mjs.

const SYSTEM = `You turn lesson material into a short lecture video presented by "Uncle Tommy", a warm, upbeat teacher.
Reply with ONE JSON object and nothing else (no markdown fences). Shape:
{
  "eyebrow": "Lango English · <short course or lesson name>",
  "intro": {
    "narration": "<Uncle Tommy introduces himself and the lesson, 35-70 words>",
    "title": "<lesson title, max 8 words>",
    "highlight": "<a few words of the title to colour, copied exactly from title>",
    "points": [{ "text": "<what we will learn, max 8 words>", "cue": "<exact phrase from intro narration>" }]
  },
  "scenes": [
    {
      "title": "<slide title, max 6 words>",
      "narration": "<what Uncle Tommy says on this slide, 40-85 words>",
      "blocks": [ <2 to 5 blocks, see below> ]
    }
  ],
  "outro": {
    "narration": "<recap and goodbye, 30-60 words>",
    "title": "<closing line, max 7 words>",
    "points": [{ "text": "<key takeaway, max 9 words>", "cue": "<exact phrase from outro narration>" }],
    "bye": "<short goodbye shown on screen, max 5 words>"
  }
}
Block types (every block has "cue": an exact phrase of 2-5 words copied from that slide's narration, in the order spoken):
  { "type": "point", "text": "<key idea, max 14 words>", "cue": "..." }
  { "type": "say", "who": "You" | "Guest" | "<short label>", "text": "<a sentence a learner would say>", "cue": "..." }
  { "type": "pills", "items": [{ "text": "<1-4 words>", "cue": "..." }] }   (2-4 items)
  { "type": "cards", "items": [{ "tag": "<1-2 words>", "text": "<max 9 words>", "cue": "..." }] }   (2-3 items)
  { "type": "note", "text": "<tip or warning, max 16 words>", "cue": "..." }
Rules:
- 3 to 8 scenes, following the material's order. Cover the material faithfully; do not invent facts.
- Write narration and on-screen text in the language of the material (English material -> English).
- Wrap 1-3 important words per block in **double asterisks** to bold them.
- Narration is spoken aloud: plain sentences, no lists, no emoji, no markdown.
- Every cue must appear word-for-word in its slide's narration.`;

export async function planLecture(routerBase, script, log) {
  log("Writing the lesson plan…");
  const text = await routerText(routerBase, {
    system: SYSTEM,
    prompt: `Lesson material:\n\n${script}`,
  });
  const plan = normalizePlan(parseJson(text));
  log(`Plan ready: ${plan.scenes.length} slides.`);
  return plan;
}

async function routerText(routerBase, body) {
  const res = await fetch(`${routerBase}/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Lesson plan (router): ${data?.message || data?.error || res.status}`);
  const out = String(data?.text || "").trim();
  if (!out) throw new Error("Lesson plan (router): empty reply.");
  return out;
}

function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Lesson plan was not JSON.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Lesson plan was not valid JSON.");
  }
}

const str = (value, max = 400) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function cued(item) {
  return { text: str(item?.text, 200), cue: str(item?.cue, 80) };
}

function normalizeBlock(block) {
  const type = String(block?.type || "").toLowerCase();
  if (type === "say") return { type, who: str(block.who, 20) || "You", ...cued(block) };
  if (type === "pills" || type === "cards") {
    const items = (Array.isArray(block.items) ? block.items : [])
      .map((item) => ({ ...cued(item), ...(type === "cards" ? { tag: str(item?.tag, 24) } : {}) }))
      .filter((item) => item.text)
      .slice(0, type === "pills" ? 4 : 3);
    return items.length ? { type, items } : null;
  }
  if (type === "note" || type === "point") return { type, ...cued(block) };
  return block?.text ? { type: "point", ...cued(block) } : null;
}

export function normalizePlan(raw) {
  const intro = raw?.intro || {};
  const outro = raw?.outro || {};
  const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : [])
    .map((scene) => ({
      title: str(scene?.title, 80),
      narration: str(scene?.narration, 1200),
      blocks: (Array.isArray(scene?.blocks) ? scene.blocks : []).map(normalizeBlock).filter((b) => b && (b.text || b.items)).slice(0, 5),
    }))
    .filter((scene) => scene.narration && scene.blocks.length)
    .slice(0, 8);
  if (!scenes.length) throw new Error("Lesson plan had no slides.");
  const title = str(intro.title, 90) || scenes[0].title;
  return {
    eyebrow: str(raw?.eyebrow, 80) || "Lango English",
    intro: {
      narration: str(intro.narration, 1000) || `Hello, I'm Uncle Tommy. Today's lesson is ${title}.`,
      title,
      highlight: str(intro.highlight, 60),
      points: (Array.isArray(intro.points) ? intro.points : []).map(cued).filter((p) => p.text).slice(0, 4),
    },
    scenes,
    outro: {
      narration: str(outro.narration, 1000) || "Great work today. See you next time!",
      title: str(outro.title, 80) || "Great work today!",
      points: (Array.isArray(outro.points) ? outro.points : []).map(cued).filter((p) => p.text).slice(0, 4),
      bye: str(outro.bye, 40) || "See you next time!",
    },
  };
}
