import { DurableObject } from "cloudflare:workers";
import { applyRoomEvent, applyRoomJob, applyRoomTimer, buzzSubmitCheck, markSocketClosed } from "./room-events.js";
import { completeText, speak, speechReady, textModelReady, transcribe } from "./ai.js";
import { buzzFeedbackPrompt, parseBuzzFeedback } from "./buzz-feedback.js";
import { semesterLeaderboard } from "./d1-api.js";
import { createRoomState, emptyRoomState, syncRoomRoster } from "./room-state.js";
import { queueOpenScores } from "./room-scores.js";
import { saveScoreBatch } from "./score-store.js";

const SCORE_RETRY_MS = 60 * 1000;
// A SQLite row in a Durable Object holds at most 2 MB; longer recordings are
// marked but not kept for replay.
const AUDIO_MAX_CHARS = 1_900_000;

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
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS audio (
          id TEXT PRIMARY KEY,
          body TEXT NOT NULL
        )
      `);
    });
  }

  open(input) {
    const state = createRoomState(input);
    const unsaved = this.#read()?.pendingScores;
    if (unsaved?.length) state.pendingScores = unsaved;
    this.ctx.storage.sql.exec("DELETE FROM audio");
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

  // Scores earned before the session ended go to D1 first. If D1 refuses
  // them, the room stays as a closed shell and its alarm retries the save.
  async close() {
    const state = this.#read();
    if (state?.session) {
      queueOpenScores(state, Date.now());
      state.game = null;
      state.buzz = null;
      delete state.timer;
      state.session.status = "ended";
      state.closed = true;
      this.#write(state);
      await this.#flushScores();
    }
    return { ok: true, scoresPending: await this.#finishClose() };
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
    const attachment = ws.deserializeAttachment() || {};
    let state = this.#read();
    if (state?.closed) {
      send(ws, { t: "ack", id: incoming.id, data: { ok: false, error: "This class session has ended." } });
      return;
    }
    const ctx = () => ({
      socketId: attachment.id || crypto.randomUUID(),
      role: attachment.role || null,
      playerId: attachment.playerId || null,
      now: Date.now(),
      pick: (count) => (count > 0 ? crypto.getRandomValues(new Uint32Array(1))[0] % count : 0),
      caps: this.#caps(state),
    });

    if (incoming.event === "submit_buzzin_response") {
      const check = buzzSubmitCheck(state, ctx());
      if (!check.ok) {
        send(ws, { t: "ack", id: incoming.id, data: check });
        return;
      }
      const spoken = await this.#spokenAnswer(incoming.data, check.sttLanguage);
      if (spoken.error) {
        send(ws, { t: "ack", id: incoming.id, data: { ok: false, error: spoken.error } });
        return;
      }
      incoming = { ...incoming, data: spoken.data };
      state = this.#read();
      if (state?.closed) return;
    }

    const result = applyRoomEvent(state, incoming, ctx());
    if (result.state) this.#write(result.state);
    if (result.attachment) {
      ws.serializeAttachment({ ...attachment, ...result.attachment });
    }
    await this.#deliver(result, { ws, ackId: incoming.id });
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment() || {};
    const state = this.#read();
    if (state?.closed) return;
    const result = markSocketClosed(state, { socketId: attachment.id, now: Date.now() });
    if (result.state) this.#write(result.state);
    if (result.timer?.kind === "host-grace") {
      console.log(
        JSON.stringify({
          message: "host_offline_grace",
          roomId: result.state?.session?.roomId || null,
          graceMs: 60000,
        })
      );
    }
    await this.#deliver(result, {});
  }

  async alarm() {
    const state = this.#read();
    if (state?.closed) {
      await this.#flushScores();
      await this.#finishClose();
      return;
    }
    if (!state?.timer) return;
    const result = applyRoomTimer(state, Date.now(), this.#caps(state));
    if (result.state) this.#write(result.state);
    await this.#deliver(result, {});
  }

  // Sends what an event, timer or job produced, then runs the model calls it
  // asked for. A deferred ack is answered by the job that finishes the event.
  async #deliver(result, { ws, ackId }) {
    const frames = result.broadcasts || [];
    let semester = null;
    if (result.ackSemester || frames.some((frame) => frame.semester)) {
      await this.#flushScores();
      semester = await this.#semester();
    }
    if (ws && result.ack !== undefined && !result.deferAck) {
      const ack = result.ackSemester && semester ? { ...result.ack, semesterLeaderboard: semester } : result.ack;
      send(ws, { t: "ack", id: ackId, data: this.#forSocket(ws, ack) });
    }
    if (ws) {
      for (const frame of result.direct || []) send(ws, { t: "event", event: frame.event, data: frame.data });
    }
    this.#broadcast(frames, semester);
    await this.#arm(result);
    await this.#flushScores();
    for (const job of result.jobs || []) {
      const outcome = await this.#runJob(job);
      const latest = this.#read();
      if (!latest || latest.closed) {
        if (result.deferAck && ws) send(ws, { t: "ack", id: ackId, data: { ok: false, error: "This class session has ended." } });
        return;
      }
      const applied = applyRoomJob(latest, job, outcome, Date.now());
      if (applied.state) this.#write(applied.state);
      await this.#deliver(applied, result.deferAck ? { ws, ackId } : {});
    }
  }

  async #runJob(job) {
    try {
      if (job.kind === "question-tts" || job.kind === "buzz-announce") {
        const speech = await speak(this.env, job.text, {
          language: job.language,
          purpose: job.kind === "question-tts" ? "question" : "announcement",
          variant: job.variant,
        });
        return { audioId: this.#saveAudio(speech.audioContent), format: speech.format };
      }
      if (job.kind === "buzz-analyze") {
        const reply = await completeText(
          this.env,
          [{ role: "user", content: buzzFeedbackPrompt(job) }],
          220,
          { title: "Lango Buzz In" }
        );
        const feedback = parseBuzzFeedback(reply, job.studentName);
        if (!job.speech) return { ok: true, ...feedback };
        try {
          const speech = await speak(this.env, feedback.spokenFeedback, {
            language: job.speakLanguage,
            purpose: "feedback",
            variant: job.variant,
          });
          return { ok: true, ...feedback, audioId: this.#saveAudio(speech.audioContent), format: speech.format };
        } catch (error) {
          logJobError(job, error, "speech");
          return { ok: true, ...feedback };
        }
      }
    } catch (error) {
      logJobError(job, error);
      return { ok: false, error: error instanceof Error ? error.message : "Model request failed." };
    }
    return {};
  }

  // A spoken answer becomes text before the room sees it; the recording is
  // kept for the host to replay.
  async #spokenAnswer(data, language) {
    const next = { ...(data || {}) };
    const audio = String(next.audioBase64 || "").trim();
    delete next.audioBase64;
    if (audio) {
      next.hadAudio = true;
      const base64 = audio.startsWith("data:") ? audio.slice(audio.indexOf(",") + 1) : audio;
      if (base64.length <= AUDIO_MAX_CHARS) {
        next.responseAudioId = this.#saveAudio(base64);
        next.responseAudioFormat = String(next.format || "webm").trim().toLowerCase().replace(/^\./, "") || "webm";
      }
    }
    if (String(next.text || "").trim() || !audio) return { data: next };
    try {
      next.text = await transcribe(this.env, { audioBase64: audio, format: next.format, language });
      return { data: next };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Transcription failed." };
    }
  }

  #caps(state) {
    const variant = state?.session?.variant || "";
    return { speech: speechReady(this.env, variant), text: textModelReady(this.env) };
  }

  async #semester() {
    const session = this.#read()?.session;
    if (!session) return [];
    try {
      return await semesterLeaderboard(this.env, session.teacherId, session.classId);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "semester_leaderboard_failed",
          roomId: session.roomId,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return [];
    }
  }

  #saveAudio(base64) {
    const body = String(base64 || "");
    if (!body || body.length > AUDIO_MAX_CHARS) return null;
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec("INSERT INTO audio (id, body) VALUES (?, ?)", id, body);
    return id;
  }

  #loadAudio(ref) {
    if (typeof ref !== "string" || !ref.startsWith("audio:")) return ref ?? null;
    const row = this.ctx.storage.sql.exec("SELECT body FROM audio WHERE id = ?", ref.slice(6)).toArray()[0];
    return row?.body || null;
  }

  // Hosts get audio filled in; students never receive host-only frames.
  #forSocket(ws, data) {
    const role = ws.deserializeAttachment()?.role;
    if (role !== "host" || !data || typeof data !== "object") return data;
    const next = { ...data };
    if (typeof next.audioContent === "string") next.audioContent = this.#loadAudio(next.audioContent);
    if (next.answerAnnouncement?.audio) {
      next.answerAnnouncement = { ...next.answerAnnouncement, audio: this.#loadAudio(next.answerAnnouncement.audio) };
    }
    if (typeof next.announcementAudio === "string") next.announcementAudio = this.#loadAudio(next.announcementAudio);
    if (Array.isArray(next.responses)) {
      next.responses = next.responses.map((item) => ({
        ...item,
        responseAudio: this.#loadAudio(item.responseAudio),
        analysisAudio: this.#loadAudio(item.analysisAudio),
      }));
    }
    return next;
  }

  // Saves queued score batches, then drops the saved ones from the latest
  // stored state; other events may have queued more while D1 was writing.
  async #flushScores() {
    const pending = this.#read()?.pendingScores;
    if (!pending?.length) return;
    if (!this.env.DB) {
      console.error(JSON.stringify({ message: "scores_save_failed", error: "DB binding missing", batches: pending.length }));
      return;
    }
    const saved = new Set();
    for (const batch of pending) {
      try {
        const result = await saveScoreBatch(this.env.DB, batch);
        saved.add(batch.id);
        console.log(
          JSON.stringify({
            message: "scores_saved",
            roomId: batch.roomId,
            classId: batch.classId,
            exerciseId: batch.exerciseId,
            exerciseType: batch.exerciseType,
            saved: result.saved,
            skipped: result.skipped,
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "scores_save_failed",
            roomId: batch.roomId,
            exerciseId: batch.exerciseId,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }
    if (!saved.size) return;
    const latest = this.#read();
    if (!latest) return;
    latest.pendingScores = (latest.pendingScores || []).filter((batch) => !saved.has(batch.id));
    this.#write(latest);
  }

  async #finishClose() {
    const state = this.#read();
    if (!state?.closed) return 0;
    const left = state.pendingScores?.length || 0;
    if (left) {
      await this.ctx.storage.setAlarm(Date.now() + SCORE_RETRY_MS);
      return left;
    }
    await this.ctx.storage.deleteAlarm();
    this.ctx.storage.sql.exec("DELETE FROM room");
    this.ctx.storage.sql.exec("DELETE FROM audio");
    return 0;
  }

  #broadcast(frames, semester) {
    if (!frames?.length) return;
    for (const ws of this.ctx.getWebSockets()) {
      const host = ws.deserializeAttachment()?.role === "host";
      for (const frame of frames) {
        if (frame.hostOnly && !host) continue;
        let data = host && frame.hostData ? frame.hostData : frame.data;
        if (frame.semester && semester) data = { ...data, semesterLeaderboard: semester };
        send(ws, { t: "event", event: frame.event, data: this.#forSocket(ws, data) });
      }
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

function logJobError(job, error, step = "") {
  console.error(
    JSON.stringify({
      message: "room_model_job_failed",
      kind: job.kind,
      step: step || undefined,
      error: error instanceof Error ? error.message : String(error),
    })
  );
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
