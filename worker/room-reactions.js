// Emoji reactions: a student taps an emoji on the join page and it floats up on
// the host screen. Off unless the host turns it on (only the autoclass page does),
// so the join page shows no emoji bar in a normal class.
//
//   set_reactions { enabled }   host only; turns the "I don't get it" button on or off
//   set_emoji { open }          host only; opens or closes the emoji bar (closed unless opened)
//   send_reaction { emoji }     student; relayed to the host as "reaction", only while the bar is open
//   send_lost {}                student; "I don't get it", relayed to the host as "lost"
//
// The two are separate on purpose: "I don't get it" is useful all through the lesson, while
// emoji are a distraction while the class is watching, so the autoclass page opens them only
// at the moments it chooses (the results of a question).
//
// "lost" carries the student's id and no name: the host screen counts how many different
// students are lost and never shows who.
//
// A reaction changes no room state, so it is relayed without a storage write.
import { done, isHost, isStudent } from "./room-core.js";

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "👏", "🎉"];

export function setReactions(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can turn reactions on or off." } });
  state.session.reactions = !!data.enabled;
  return done(state, {
    ack: { ok: true, enabled: state.session.reactions },
    broadcasts: [reactionsEvent(state)],
  });
}

export function setEmoji(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can open or close the emoji." } });
  state.session.emojiOpen = !!data.open;
  return done(state, {
    ack: { ok: true, open: state.session.emojiOpen },
    broadcasts: [reactionsEvent(state)],
  });
}

export function sendReaction(state, data, ctx) {
  if (!state.session.reactions || !state.session.emojiOpen) return done(null, { ack: { ok: false, error: "Emoji are closed right now." } });
  if (!isStudent(ctx)) return done(null, { ack: { ok: false, error: "Join the class first." } });
  const emoji = String(data.emoji || "");
  if (!REACTION_EMOJIS.includes(emoji)) return done(null, { ack: { ok: false, error: "Unknown reaction." } });
  const student = (state.session.participants || []).find((item) => item.userId === ctx.playerId);
  return done(null, {
    ack: { ok: true },
    broadcasts: [{ event: "reaction", hostOnly: true, data: { emoji, name: student?.displayName || "" } }],
  });
}

export function sendLost(state, data, ctx) {
  if (!state.session.reactions) return done(null, { ack: { ok: false, error: "Reactions are off." } });
  if (!isStudent(ctx)) return done(null, { ack: { ok: false, error: "Join the class first." } });
  return done(null, {
    ack: { ok: true },
    broadcasts: [{ event: "lost", hostOnly: true, data: { playerId: ctx.playerId } }],
  });
}

export function reactionsEvent(state) {
  return {
    event: "reactions_state",
    data: { enabled: !!state.session.reactions, emojis: REACTION_EMOJIS, emojiOpen: !!state.session.reactions && !!state.session.emojiOpen },
  };
}
