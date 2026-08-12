const { normalizeClassItem } = require("./lango-classes");

/** @type {Map<string, Session>} */
const sessions = new Map();

function generateParticipantId() {
  return `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createSession({
  roomId,
  teacherId,
  classId,
  courseId,
  exercise,
  classItem,
  course,
  authToken,
  uiLocale,
}) {
  const normalizedClass = normalizeClassItem(classItem || {});
  const session = {
    roomId,
    teacherId,
    classId,
    courseId,
    className: normalizedClass?.name || classItem?.name || "",
    studentList: normalizedClass?.studentList || [],
    courseName: course?.name || course?.title || "",
    authToken: authToken || null,
    exercise,
    status: "waiting",
    participants: new Map(),
    hostSocketId: null,
    buzzinExerciseId: null,
    buzzinAwardedPlayers: new Map(),
    uiLocale: normalizeUiLocale(uiLocale),
    createdAt: Date.now(),
    startedAt: null,
  };
  sessions.set(roomId, session);
  return session;
}

function normalizeUiLocale(locale) {
  const supported = new Set([
    "en",
    "zh-TW",
    "yue",
    "zh-CN",
    "hi",
    "es",
    "fr",
    "ar",
    "bn",
    "pt",
    "ru",
    "id",
    "de",
    "ja",
    "ms",
    "my",
  ]);
  const raw = String(locale || "").trim();
  if (supported.has(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower === "zh-tw" || lower === "zh_hant" || lower === "zh-hant") return "zh-TW";
  if (lower === "zh-cn" || lower === "zh_hans" || lower === "zh-hans") return "zh-CN";
  if (lower === "yue" || lower === "zh-hk" || lower === "zh_hk") return "yue";
  if (lower.startsWith("hi")) return "hi";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("ar")) return "ar";
  if (lower.startsWith("bn")) return "bn";
  if (lower.startsWith("pt")) return "pt";
  if (lower.startsWith("ru")) return "ru";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("ms")) return "ms";
  if (lower.startsWith("id")) return "id";
  if (lower === "my" || lower.startsWith("my-") || lower.startsWith("bur")) return "my";
  if (lower.startsWith("zh")) return "zh-TW";
  if (lower.startsWith("en")) return "en";
  return "en";
}

function setUiLocale(session, locale) {
  if (!session) return "en";
  session.uiLocale = normalizeUiLocale(locale);
  return session.uiLocale;
}

function getSession(roomId) {
  return sessions.get(roomId) || null;
}

function deleteSession(roomId) {
  sessions.delete(roomId);
}

function listParticipants(session) {
  return [...session.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

function participantPayload(session) {
  return listParticipants(session).map((p) => ({
    id: p.userId,
    userId: p.userId,
    displayName: p.displayName,
    isReady: !!p.isReady,
    joinedAt: p.joinedAt,
  }));
}

function addParticipant(session, { userId, displayName, socketId }) {
  const existing = session.participants.get(userId);
  if (existing) {
    if (displayName) existing.displayName = displayName;
    existing.socketId = socketId;
    return existing;
  }

  const participant = {
    userId,
    displayName,
    socketId,
    isReady: false,
    joinedAt: Date.now(),
  };
  session.participants.set(userId, participant);
  return participant;
}

function removeParticipantBySocket(session, socketId) {
  for (const [userId, participant] of session.participants) {
    if (participant.socketId === socketId) {
      session.participants.delete(userId);
      return userId;
    }
  }
  return null;
}

function setHost(session, socketId) {
  session.hostSocketId = socketId;
}

function startSession(session) {
  if (session.status === "start") return false;
  session.status = "start";
  session.startedAt = Date.now();
  return true;
}

function waitSession(session) {
  if (session.status === "ended") return false;
  session.status = "waiting";
  session.startedAt = null;
  session.exercise = null;
  return true;
}

function updateExercise(session, exercise, course) {
  if (!exercise?.id) return false;
  session.exercise = exercise;
  if (course?.id) {
    session.courseId = course.id;
    session.courseName = course.name || course.title || "";
  }
  return true;
}

module.exports = {
  sessions,
  generateParticipantId,
  createSession,
  getSession,
  deleteSession,
  listParticipants,
  participantPayload,
  addParticipant,
  removeParticipantBySocket,
  setHost,
  startSession,
  waitSession,
  updateExercise,
  normalizeUiLocale,
  setUiLocale,
};
