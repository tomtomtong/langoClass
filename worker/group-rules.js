// Several rooms (places) running the same lesson live, linked by a group code, so a student's
// question for Uncle Tommy can be answered in the asking room and watched in the others.
// These are the rules, as plain functions over one group's data; GroupDurableObject
// (worker/group.js) keeps the data and calls them. docs/autoclass-tutor-multiplace-plan.md
// explains the design.
//
// A group's data:
//   { code, lessonId, lessonTitle, rate, createdAt, lastActive,
//     members:   { [roomId]: { joinedAt } },
//     waiting:   [{ askId, roomId, name, at }]   questions waiting for a free slot (rate limit)
//     starts:    [ms]                            when answers were started in the last minute
//     answers:   [{ askId, roomId, name, question, answer, language, audioUrl,
//                   questionAudioUrl, createdAt, views }]
//     delivered: { [roomId]: [askId] }           answers a room has already been given
//     stt:       { [minute]: count } }           speech-to-text calls, to cap the cost

export const GROUP_MAX_ROOMS = 100;
export const GROUP_RATE_DEFAULT = 10; // answers started per minute, whole group
export const STT_PER_MIN = 20; // recordings turned into text per minute, whole group
export const RATE_WINDOW_MS = 60 * 1000;
export const QUEUE_TTL_MS = 2 * 60 * 1000; // a question waits for a slot at most this long
export const ANSWER_TTL_MS = 3 * 60 * 1000; // another room can still pick an answer this long
export const ANSWER_KEEP_MS = 10 * 60 * 1000; // then it is dropped
export const GROUP_LIFETIME_MS = 12 * 60 * 60 * 1000; // after the last activity
const ANSWERS_MAX = 400;

// A group code is four digits.
export function groupCode(value) {
  const code = String(value ?? "").trim();
  return /^\d{4}$/.test(code) ? code : "";
}

export function newGroup({ code, lessonId, lessonTitle, rate, now }) {
  return {
    code,
    lessonId: String(lessonId || ""),
    lessonTitle: String(lessonTitle || "").slice(0, 120),
    rate: rateOf(rate),
    createdAt: now,
    lastActive: now,
    members: {},
    waiting: [],
    starts: [],
    answers: [],
    delivered: {},
    stt: {},
  };
}

function rateOf(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : GROUP_RATE_DEFAULT;
}

const idOf = (roomId, askId) => `${roomId}:${askId}`;

export function memberCount(group) {
  return Object.keys(group.members).length;
}

// A room joins (again, if it is already in). Another lesson, or a full group, is refused.
export function joinGroup(group, { roomId, lessonId }, now) {
  if (!roomId) return { ok: false, error: "No room." };
  if (group.lessonId && String(lessonId || "") !== group.lessonId) {
    return { ok: false, error: "This group code is already used by another lesson." };
  }
  if (!group.members[roomId] && memberCount(group) >= GROUP_MAX_ROOMS) {
    return { ok: false, error: "This group is full." };
  }
  group.members[roomId] ||= { joinedAt: now };
  group.lastActive = now;
  return { ok: true, members: memberCount(group), lessonTitle: group.lessonTitle };
}

// A room leaves; its waiting questions go with it. `empty` says the group has no rooms left.
export function leaveGroup(group, roomId, now) {
  delete group.members[roomId];
  delete group.delivered[roomId];
  group.waiting = group.waiting.filter((item) => item.roomId !== roomId);
  group.lastActive = now;
  return { empty: memberCount(group) === 0 };
}

// Whether one more recording may be turned into text now. Counts it when it may.
export function allowStt(group, now, limit = STT_PER_MIN) {
  const minute = Math.floor(now / RATE_WINDOW_MS);
  const used = (group.stt[minute] || 0) + (group.stt[minute - 1] || 0) * Math.max(0, 1 - (now % RATE_WINDOW_MS) / RATE_WINDOW_MS);
  if (used >= limit) return false;
  group.stt[minute] = (group.stt[minute] || 0) + 1;
  return true;
}

function recentStarts(group, now) {
  return group.starts.filter((at) => at > now - RATE_WINDOW_MS);
}

// A room has a question to answer. It starts at once when the group has started fewer than
// `rate` answers in the last minute; otherwise it waits its turn.
export function submitAsk(group, { roomId, askId, name }, now) {
  group.lastActive = now;
  group.starts = recentStarts(group, now);
  if (!group.waiting.length && group.starts.length < group.rate) {
    group.starts.push(now);
    return { start: true };
  }
  group.waiting = group.waiting.filter((item) => !(item.roomId === roomId && item.askId === askId));
  group.waiting.push({ askId, roomId, name: String(name || ""), at: now });
  return { queued: true, position: group.waiting.length };
}

// Questions whose turn has come (`start`), questions that waited too long (`expired`), and when to
// look again (`nextDue`, ms; null when nothing waits).
export function drainWaiting(group, now) {
  group.starts = recentStarts(group, now);
  const expired = group.waiting.filter((item) => now - item.at >= QUEUE_TTL_MS);
  group.waiting = group.waiting.filter((item) => now - item.at < QUEUE_TTL_MS);
  const start = [];
  while (group.waiting.length && group.starts.length < group.rate) {
    const item = group.waiting.shift();
    group.starts.push(now);
    start.push(item);
  }
  let nextDue = null;
  if (group.waiting.length) {
    const slot = group.starts.length >= group.rate ? Math.min(...group.starts) + RATE_WINDOW_MS : now;
    const expiry = Math.min(...group.waiting.map((item) => item.at + QUEUE_TTL_MS));
    nextDue = Math.min(slot, expiry);
  }
  return { start, expired, nextDue };
}

// A question that could not be started after all (its room has gone): its slot is given back.
export function giveBackStart(group, now) {
  const recent = recentStarts(group, now);
  recent.pop();
  group.starts = recent;
}

// An answer is ready; other rooms can pick it.
export function publishAnswer(group, { roomId, askId, name, question, answer, language, audioUrl, questionAudioUrl }, now) {
  group.lastActive = now;
  group.answers = group.answers.filter((item) => idOf(item.roomId, item.askId) !== idOf(roomId, askId));
  group.answers.push({
    askId,
    roomId,
    name: String(name || ""),
    question: String(question || ""),
    answer: String(answer || ""),
    language: String(language || "en"),
    audioUrl: audioUrl || null,
    questionAudioUrl: questionAudioUrl || null,
    createdAt: now,
    views: 0,
  });
  if (group.answers.length > ANSWERS_MAX) group.answers.splice(0, group.answers.length - ANSWERS_MAX);
}

// One answer for a room that has none of its own: not its own, not one it was already given,
// recent. The one fewest rooms have been given comes first, so every answer finds an audience;
// among equals it is random (`pick(n)` returns 0..n-1). Null when there is none.
export function pickAnswer(group, roomId, now, pick = (n) => Math.floor(Math.random() * n)) {
  group.lastActive = now;
  const given = new Set(group.delivered[roomId] || []);
  const fresh = group.answers.filter(
    (item) => item.roomId !== roomId && !given.has(idOf(item.roomId, item.askId)) && now - item.createdAt < ANSWER_TTL_MS
  );
  if (!fresh.length) return null;
  const fewest = Math.min(...fresh.map((item) => item.views));
  const tied = fresh.filter((item) => item.views === fewest);
  const chosen = tied[pick(tied.length)] || tied[0];
  chosen.views += 1;
  const id = idOf(chosen.roomId, chosen.askId);
  (group.delivered[roomId] ||= []).push(id);
  return { ...chosen, askId: id };
}

// Old answers, old counters and rooms' delivered lists for answers that are gone.
export function pruneGroup(group, now) {
  group.answers = group.answers.filter((item) => now - item.createdAt < ANSWER_KEEP_MS);
  const kept = new Set(group.answers.map((item) => idOf(item.roomId, item.askId)));
  for (const roomId of Object.keys(group.delivered)) {
    group.delivered[roomId] = group.delivered[roomId].filter((id) => kept.has(id));
    if (!group.delivered[roomId].length) delete group.delivered[roomId];
  }
  const minute = Math.floor(now / RATE_WINDOW_MS);
  for (const key of Object.keys(group.stt)) if (Number(key) < minute - 1) delete group.stt[key];
  group.starts = recentStarts(group, now);
}

// When the group has nothing left to do and can be cleared.
export function groupExpired(group, now) {
  return now - group.lastActive >= GROUP_LIFETIME_MS;
}
