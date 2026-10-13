// One classroom room: the session, the live game, the buzz-in round, and
// socket metadata. Socket.IO still runs on Node until that transport moves.
export function createRoomState({
  roomId,
  teacherId,
  classItem,
  course,
  exercise,
  uiLocale,
  now = Date.now(),
} = {}) {
  const classId = classItem?.id ?? classItem?.class_id ?? classItem?.classId ?? null;
  const className = text(classItem?.name || classItem?.class_name || classItem?.className);
  return {
    session: {
      roomId,
      teacherId: teacherId ?? null,
      classId,
      className,
      courseId: course?.id ?? null,
      courseName: text(course?.name || course?.title),
      exercise: exercise || null,
      status: "waiting",
      studentList: studentListOf(classItem),
      participants: [],
      hostSocketId: null,
      buzzinExerciseId: null,
      buzzinAwardedPlayers: [],
      uiLocale: text(uiLocale || "en").slice(0, 16) || "en",
      createdAt: now,
      startedAt: null,
    },
    game: null,
    buzz: null,
    sockets: {},
  };
}

export function syncRoomRoster(state, classItem) {
  if (!state?.session) return null;
  const studentList = studentListOf(classItem);
  if (!studentList.length) return state;
  const className = text(classItem?.name || classItem?.class_name || classItem?.className);
  return {
    ...state,
    session: {
      ...state.session,
      studentList,
      className: className || state.session.className,
    },
  };
}

export function emptyRoomState() {
  return { session: null, game: null, buzz: null, sockets: {} };
}

function studentListOf(classItem) {
  const list = classItem?.studentList || classItem?.student_list || classItem?.students;
  return Array.isArray(list) ? list : [];
}

function text(value) {
  return String(value || "").trim();
}
