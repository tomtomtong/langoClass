// Results cheer: on the results page for a question the students who got it right are on screen, and
// Uncle Tommy thanks a few of them by name. The line is a fixed template (no model), read in his voice.
//
//   result_cheer { names: [..], lesson: { language } }   host only
//     -> ack { ok, pending } at once; the "result-cheer" job (room.js) reads the line aloud, and the
//        host then gets result_cheer { say, audioContent } (audioContent is null if the voice failed).
//
// Privacy: only names already on the big screen's board, and only to the host.
import { audioRef, clip, done, isHost, languageOf } from "./room-core.js";

export const MAX_CHEER_NAMES = 3;

export function requestCheer(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can ask for a cheer." } });
  const names = (Array.isArray(data?.names) ? data.names : [])
    .map((name) => clip(String(name || "").replace(/\s+/g, " ").trim(), 40))
    .filter(Boolean)
    .slice(0, MAX_CHEER_NAMES);
  if (!names.length || !ctx.caps?.speech) return done(state, { ack: { ok: true, pending: false } });
  const language = languageOf(data?.lesson?.language) || "en";
  return done(state, {
    ack: { ok: true, pending: true },
    jobs: [{ kind: "result-cheer", language, variant: state.session?.variant || "", names, say: cheerLine(names, language) }],
  });
}

export function applyCheerJob(state, job, outcome) {
  return done(state, {
    broadcasts: [{
      event: "result_cheer",
      hostOnly: true,
      data: { say: job.say, audioContent: outcome?.audioId ? audioRef(outcome.audioId) : null },
    }],
  });
}

// "Thank you Ada, Bo and Cy: well done!" in the lesson's language.
export function cheerLine(names, language) {
  if (language === "yue") {
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join("、")} 同 ${names[names.length - 1]}`;
    return names.length === 1 ? `${list}，答得好呀，好叻！` : `多謝 ${list}，答得又快又啱！`;
  }
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Well done ${list}! Great answers!`;
}
