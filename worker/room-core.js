// Small helpers shared by the room event modules (room-events.js and
// room-open-answer.js), kept here so the two never import each other.

// The shape every room event handler returns.
export function done(state, extra = {}) {
  if (extra.timer) state && (state.timer = extra.timer);
  if (extra.clearTimer && state) delete state.timer;
  return {
    state,
    ack: extra.ack,
    broadcasts: extra.broadcasts || [],
    direct: extra.direct || [],
    attachment: extra.attachment || null,
    timer: extra.timer || null,
    clearTimer: !!extra.clearTimer,
    jobs: extra.jobs || [],
    deferAck: !!extra.deferAck,
    ackSemester: !!extra.ackSemester,
  };
}

export function isHost(ctx) {
  return ctx.role === "host";
}

export function isStudent(ctx) {
  return !!ctx.playerId && (ctx.role === "session_player" || ctx.role === "player");
}

// Audio lives in the room's own table, not in the room state; payloads carry
// a reference that the Durable Object fills in for host sockets.
export function audioRef(id) {
  return `audio:${id}`;
}

export function languageOf(value) {
  const code = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(code) ? code : "";
}

export function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}
