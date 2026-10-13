import { DurableObject } from "cloudflare:workers";
import { applyRoomEvent, applyRoomTimer, markSocketClosed } from "./room-events.js";
import { requestSpeechText } from "./models.js";
import { createRoomState, emptyRoomState, syncRoomRoster } from "./room-state.js";

export class RoomDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          body TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    });
  }

  open(input) {
    const state = createRoomState(input);
    this.#write(state);
    return summarize(state);
  }

  syncRoster(classItem) {
    const state = this.#read();
    if (!state?.session) return { ok: false };
    const next = syncRoomRoster(state, classItem);
    this.#write(next);
    return { ok: true, studentCount: next.session.studentList.length };
  }

  close() {
    this.ctx.storage.sql.exec("DELETE FROM room");
    return { ok: true };
  }

  read() {
    return summarize(this.#read());
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID(), role: null, playerId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let incoming;
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      incoming = JSON.parse(text);
    } catch {
      return;
    }
    if (incoming?.t !== "emit" || !incoming.event) return;
    if (incoming.event === "submit_buzzin_response") {
      const spoken = await spokenAnswer(this.env, incoming.data);
      if (spoken.error) {
        send(ws, { t: "ack", id: incoming.id, data: { ok: false, error: spoken.error } });
        return;
      }
      if (spoken.text) incoming = { ...incoming, data: { ...(incoming.data || {}), text: spoken.text } };
    }
    const attachment = ws.deserializeAttachment() || {};
    const state = this.#read();
    const result = applyRoomEvent(state, incoming, {
      socketId: attachment.id || crypto.randomUUID(),
      role: attachment.role || null,
      playerId: attachment.playerId || null,
      now: Date.now(),
      pick: (count) => (count > 0 ? crypto.getRandomValues(new Uint32Array(1))[0] % count : 0),
    });
    if (result.state) this.#write(result.state);
    if (result.attachment) {
      ws.serializeAttachment({ ...attachment, ...result.attachment });
    }
    if (result.ack !== undefined) {
      send(ws, { t: "ack", id: incoming.id, data: result.ack });
    }
    for (const frame of result.direct || []) send(ws, { t: "event", event: frame.event, data: frame.data });
    this.#broadcast(result.broadcasts);
    await this.#arm(result);
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment() || {};
    const state = this.#read();
    const result = markSocketClosed(state, { socketId: attachment.id, now: Date.now() });
    if (result.state) this.#write(result.state);
    this.#broadcast(result.broadcasts);
    if (result.timer?.kind === "host-grace") {
      console.log(
        JSON.stringify({
          message: "host_offline_grace",
          roomId: result.state?.session?.roomId || null,
          graceMs: 60000,
        })
      );
    }
    await this.#arm(result);
  }

  async alarm() {
    const state = this.#read();
    if (!state?.timer) return;
    const result = applyRoomTimer(state, Date.now());
    if (result.state) this.#write(result.state);
    this.#broadcast(result.broadcasts);
    await this.#arm(result);
  }

  #broadcast(frames) {
    if (!frames?.length) return;
    for (const ws of this.ctx.getWebSockets()) {
      for (const frame of frames) send(ws, { t: "event", event: frame.event, data: frame.data });
    }
  }

  async #arm(result) {
    if (result.clearTimer) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (result.timer?.at) await this.ctx.storage.setAlarm(result.timer.at);
  }

  #read() {
    const row = this.ctx.storage.sql.exec("SELECT body FROM room WHERE id = 1").toArray()[0];
    if (!row?.body) return null;
    try {
      return JSON.parse(row.body);
    } catch {
      return null;
    }
  }

  #write(state) {
    const body = JSON.stringify(state || emptyRoomState());
    this.ctx.storage.sql.exec(
      "INSERT INTO room (id, body, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
      body,
      new Date().toISOString()
    );
  }
}

async function spokenAnswer(env, data) {
  const text = String(data?.text || "").trim();
  const audio = String(data?.audioBase64 || "").trim();
  if (text || !audio) return {};
  try {
    return { text: await requestSpeechText(env, data) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Transcription failed." };
  }
}

function send(ws, message) {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    /* the socket may already be closing */
  }
}

function summarize(state) {
  if (!state?.session) return null;
  return {
    roomId: state.session.roomId,
    teacherId: state.session.teacherId,
    classId: state.session.classId,
    className: state.session.className,
    status: state.session.status,
    studentCount: Array.isArray(state.session.studentList) ? state.session.studentList.length : 0,
    participantCount: Array.isArray(state.session.participants) ? state.session.participants.length : 0,
    hasGame: state.game != null,
    hasBuzz: state.buzz != null,
    socketCount: state.sockets && typeof state.sockets === "object" ? Object.keys(state.sockets).length : 0,
  };
}
