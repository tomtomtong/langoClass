// One group of linked rooms (worker/group-rules.js has the rules; this keeps the data). The
// Durable Object is named by the group code. Rooms call it (RPC); it calls back into rooms to
// start an answer that has waited for its turn, and to let one go that waited too long.
//
//   join / leave          rooms come and go
//   canAsk                may one more recording be turned into text now
//   submit                a room's question is ready: start now, or wait for a slot
//   publish               an answer is ready for other rooms to pick
//   pick                  another room's answer, for a room with none of its own
//
// Everything is in memory and saved to one row; an alarm starts waiting questions, drops old
// answers, and clears the group (and its sound files in R2) a long time after the last activity.
import { DurableObject } from "cloudflare:workers";
import {
  GROUP_LIFETIME_MS,
  RATE_WINDOW_MS,
  allowStt,
  drainWaiting,
  giveBackStart,
  groupExpired,
  joinGroup,
  leaveGroup,
  memberCount,
  newGroup,
  pickAnswer,
  pruneGroup,
  publishAnswer,
  submitAsk,
} from "./group-rules.js";

export const TUTOR_AUDIO_PREFIX = "uploads/autoclass/_tutor";
const PRUNE_EVERY_MS = RATE_WINDOW_MS;

export class GroupDurableObject extends DurableObject {
  #group = null;
  #dirty = false;

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS grp (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)");
      const row = this.ctx.storage.sql.exec("SELECT body FROM grp WHERE id = 1").toArray()[0];
      try {
        this.#group = row?.body ? JSON.parse(row.body) : null;
      } catch {
        this.#group = null;
      }
    });
  }

  async join({ roomId, code, lessonId, lessonTitle, rate }) {
    const now = Date.now();
    let group = this.#group;
    if (!group || groupExpired(group, now)) {
      group = newGroup({ code, lessonId, lessonTitle, rate, now });
    }
    const result = joinGroup(group, { roomId, lessonId }, now);
    if (!result.ok) return result;
    this.#group = group;
    await this.#save();
    await this.#schedule();
    return result;
  }

  async leave(roomId) {
    const group = this.#live();
    if (!group) return { ok: true };
    const { empty } = leaveGroup(group, roomId, Date.now());
    if (empty) await this.#clear();
    else await this.#save();
    return { ok: true };
  }

  // A room that is not in this group (it never joined, or the group has gone) is told to carry on
  // by itself: `gone: true`.
  async canAsk(roomId) {
    const group = this.#live();
    if (!group || !group.members[roomId]) return { ok: true, gone: true };
    const ok = allowStt(group, Date.now());
    if (ok) this.#dirty = true;
    return ok ? { ok: true } : { ok: false, reason: "busy" };
  }

  async submit({ roomId, askId, name }) {
    const group = this.#live();
    if (!group || !group.members[roomId]) return { start: true, gone: true };
    const result = submitAsk(group, { roomId, askId, name }, Date.now());
    await this.#save();
    if (result.queued) await this.#schedule();
    return result;
  }

  async publish({ roomId, askId, payload }) {
    const group = this.#live();
    if (!group) return { ok: false };
    publishAnswer(group, { roomId, askId, ...payload }, Date.now());
    await this.#save();
    await this.#schedule();
    return { ok: true };
  }

  async pick(roomId) {
    const group = this.#live();
    if (!group || !group.members[roomId]) return { answer: null, members: 0 };
    const answer = pickAnswer(group, roomId, Date.now());
    if (answer) this.#dirty = true;
    return { answer, members: memberCount(group) };
  }

  async alarm() {
    const group = this.#group;
    if (!group) return;
    const now = Date.now();
    if (groupExpired(group, now)) {
      await this.#clear();
      return;
    }
    pruneGroup(group, now);
    const { start, expired } = drainWaiting(group, now);
    await this.#save();
    await Promise.allSettled([
      ...expired.map((item) => this.#room(item.roomId).groupNotChosen(item.askId).catch(() => null)),
      ...start.map(async (item) => {
        // The answer is made inside this call; a room that has gone gives its slot back.
        let started = false;
        try {
          started = (await this.#room(item.roomId).startTutorAnswer(item.askId))?.ok === true;
        } catch {
          started = false;
        }
        if (!started && this.#group) giveBackStart(this.#group, Date.now());
      }),
    ]);
    await this.#schedule();
  }

  #room(roomId) {
    return this.env.ROOM.getByName(roomId);
  }

  #live() {
    const group = this.#group;
    if (!group) return null;
    if (groupExpired(group, Date.now())) return null;
    return group;
  }

  async #save() {
    if (!this.#group) return;
    this.#dirty = false;
    this.ctx.storage.sql.exec(
      "INSERT INTO grp (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
      JSON.stringify(this.#group)
    );
  }

  // The next time something has to happen: a waiting question's turn or limit, old answers to drop,
  // or the end of the group's life.
  async #schedule() {
    const group = this.#group;
    if (!group) return;
    const now = Date.now();
    const due = [group.lastActive + GROUP_LIFETIME_MS];
    if (group.answers.length || group.waiting.length) due.push(now + PRUNE_EVERY_MS);
    if (group.waiting.length) {
      // Same arithmetic as drainWaiting, without changing anything.
      const clone = JSON.parse(JSON.stringify(group));
      const { nextDue } = drainWaiting(clone, now);
      if (nextDue != null) due.push(Math.max(now + 1000, nextDue));
      else due.push(now + 1000);
    }
    await this.ctx.storage.setAlarm(Math.min(...due));
  }

  // The group is over: forget it and delete its sound files from R2.
  async #clear() {
    const code = this.#group?.code;
    this.#group = null;
    this.ctx.storage.sql.exec("DELETE FROM grp");
    await this.ctx.storage.deleteAlarm();
    if (!code || !this.env.UPLOADS) return;
    try {
      const prefix = `${TUTOR_AUDIO_PREFIX}/${code}/`;
      let cursor;
      do {
        const page = await this.env.UPLOADS.list({ prefix, cursor, limit: 1000 });
        if (page.objects.length) await this.env.UPLOADS.delete(page.objects.map((object) => object.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    } catch (error) {
      console.error(JSON.stringify({ message: "group_audio_cleanup_failed", code, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
