// Class activity for log.lango.ai: what changed in a room between two saved
// states (class opened, started or ended, teacher or a student going on or
// offline), and the live "classes open now" view grouped by school. Logged
// events name students by school student code only; the live view, which is
// read on demand and never stored, also gives their names.

// The parts of a room state that activity is read from.
export function presenceOf(state) {
  const session = state?.session;
  if (!session) return null;
  const players = {};
  for (const item of session.participants || []) {
    if (item?.userId) players[item.userId] = item.online !== false;
  }
  return {
    createdAt: session.createdAt || 0,
    status: session.status || "",
    closed: !!state.closed,
    host: !!session.hostSocketId,
    players,
  };
}

// Entries for logClassActivity (lango-log.js) for the change from `before`
// to `after`.
export function activityEntries(before, after, state) {
  if (!after) return [];
  const session = state.session;
  const room = roomContext(state);
  const owner = {
    sessionId: logSessionId(session),
    schoolId: session.schoolId || "",
    teacherId: session.teacherId == null ? "" : String(session.teacherId),
  };
  const entries = [];
  const add = (code, level = "info", extra = {}) => entries.push({ ...owner, code, level, context: { ...room, ...extra } });

  if (!before || before.createdAt !== after.createdAt) {
    add("class_opened");
    before = { status: "waiting", closed: false, host: false, players: {} };
  }
  if (before.status !== after.status) {
    if (after.status === "start") add("class_started");
    if (after.status === "ended") {
      add("class_ended", after.closed ? "info" : "warn", { end_reason: after.closed ? "teacher" : "teacher_offline" });
    }
  }
  if (after.status === "ended") return entries;
  if (before.host !== after.host) add(after.host ? "teacher_online" : "teacher_offline", after.host ? "info" : "warn");
  for (const [userId, online] of Object.entries(after.players)) {
    const was = before.players[userId];
    if (was === online) continue;
    const extra = { student_code: studentRef(state, userId) };
    if (was === undefined) add("student_joined", "info", extra);
    else if (online) add("student_reconnected", "info", extra);
    else add("student_offline", "warn", extra);
  }
  return entries;
}

// One open room as the live view shows it.
export function liveRoom(state) {
  const session = state?.session;
  if (!session || session.status === "ended" || state.closed) return null;
  const participants = session.participants || [];
  return {
    school_id: session.schoolId || "",
    room_id: session.roomId || "",
    class_name: session.className || "",
    status: session.status,
    teacher_online: !!session.hostSocketId,
    online_count: participants.filter((item) => item.online !== false).length,
    roster_count: (session.studentList || []).length,
    offline: participants
      .filter((item) => item.online === false)
      .map((item) => ({ student: studentRef(state, item.userId), name: studentName(state, item), since: item.offlineSince || null })),
    course_name: session.courseName || "",
    activity: state.game ? "quiz" : state.buzz ? "buzz_in" : state.open ? "everyone_answers" : "",
    created_at: session.createdAt || null,
    started_at: session.startedAt || null,
    log_session_id: logSessionId(session),
  };
}

// Open rooms grouped by school; schools by name, unknown last, newest room first.
export function groupBySchool(rooms) {
  const schools = new Map();
  for (const room of rooms) {
    const key = room.school_id || "";
    if (!schools.has(key)) schools.set(key, []);
    schools.get(key).push(room);
  }
  return [...schools.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([schoolId, list]) => ({
      school_id: schoolId,
      rooms: list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
      online_count: list.reduce((sum, room) => sum + room.online_count, 0),
    }));
}

// One log.lango.ai session per room opening, so its history filters together.
function logSessionId(session) {
  return `class-room-${session.roomId || "unknown"}-${session.createdAt || 0}`;
}

function roomContext(state) {
  const session = state.session;
  const participants = session.participants || [];
  return {
    room_id: session.roomId || "",
    class_id: session.classId == null ? "" : String(session.classId),
    class_name: session.className || "",
    online_count: participants.filter((item) => item.online !== false).length,
    roster_count: (session.studentList || []).length,
  };
}

// The name the student joined with, else the roster's.
function studentName(state, participant) {
  const student = (state?.session?.studentList || []).find((item) => String(item?.id) === String(participant.userId));
  return String(participant.displayName || student?.fullName || "").trim().slice(0, 40);
}

// The student code a teacher knows (e.g. STU-0604), else the account id.
function studentRef(state, userId) {
  const student = (state?.session?.studentList || []).find((item) => String(item?.id) === String(userId));
  return String(student?.studentCode || student?.username || userId || "?");
}
