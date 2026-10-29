// Class session HTTP: the host opens, updates and ends a room, and a student
// ID join link finds its room. Rooms live in Durable Objects; D1 keeps the
// index of open rooms and their rosters (room-index.js). Responses match
// server.js so the host and join pages need no change.
import { normalizeStudentList } from "./classes.js";
import { requireTeacher } from "./d1-store.js";
import { claimRoomId, findStudentRoom, indexStudents, removeRoom, roomSummary } from "./room-index.js";

export async function handleRoomApi(request, env, url) {
  if (!env.ROOM || !env.DB) return null;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "POST" && pathname === "/api/session/start") return startSession(request, env);
  if (method === "PUT" && pathname === "/api/session/roster") return updateRoster(request, env);
  if (method === "POST" && pathname === "/api/session/end") return endSession(request, env);
  if ((method === "GET" || method === "HEAD") && pathname === "/api/join/lookup") return lookupStudent(env, url);
  return null;
}

async function startSession(request, env) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const body = await readBody(request);
  const { class: classItem, course, exercise, user, uiLocale } = body;
  if (classItem?.id == null || classItem.id === "" || user?.id == null || user.id === "") {
    return json({ message: "class and user with id are required." }, 400);
  }
  const studentList = normalizeStudentList(classItem);
  const className = String(classItem.name || classItem.class_name || classItem.className || "").trim();
  const roomId = await claimRoomId(env, { teacherId: auth.teacherId, classId: classItem.id, className });
  try {
    await env.ROOM.getByName(roomId).open({
      roomId,
      teacherId: auth.teacherId,
      classItem: { ...classItem, studentList },
      course: course ? { id: course.id, name: course.name || course.title || "", langCode: course.langCode || "" } : null,
      exercise: exercise || null,
      uiLocale: uiLocale || "en",
    });
    await indexStudents(env, roomId, studentList, className);
  } catch (error) {
    await removeRoom(env, roomId).catch(() => {});
    throw error;
  }
  console.log(
    JSON.stringify({
      message: "room_opened",
      roomId,
      teacherId: auth.teacherId,
      classId: classItem.id,
      studentCount: studentList.length,
    })
  );
  return json({ sessionId: roomId, roomId }, 201);
}

async function updateRoster(request, env) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const body = await readBody(request);
  const roomId = roomIdOf(body.roomId);
  if (!roomId || !body.class) return json({ message: "roomId and class are required." }, 400);
  const denied = await ownRoom(env, roomId, auth, "Not allowed to update this session.");
  if (denied) return denied;
  const studentList = normalizeStudentList(body.class);
  const result = await env.ROOM.getByName(roomId).syncRoster({ ...body.class, studentList });
  if (!result?.ok) return json({ message: "Session not found." }, 404);
  if (studentList.length) await indexStudents(env, roomId, studentList, body.class.name || "");
  console.log(JSON.stringify({ message: "room_roster", roomId, studentCount: result.studentCount }));
  return json({ ok: true, studentCount: result.studentCount });
}

async function endSession(request, env) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const body = await readBody(request);
  const roomId = roomIdOf(body.roomId);
  if (!roomId) return json({ message: "roomId is required." }, 400);
  const denied = await ownRoom(env, roomId, auth, "Not allowed to end this session.");
  if (denied) return denied;
  const result = await env.ROOM.getByName(roomId).close("Class session ended");
  await removeRoom(env, roomId);
  console.log(JSON.stringify({ message: "room_closed", roomId, scoresPending: result?.scoresPending || 0 }));
  return json({ ok: true, roomId });
}

async function lookupStudent(env, url) {
  const studentId = String(
    url.searchParams.get("studentId") || url.searchParams.get("student_id") || url.searchParams.get("token") || ""
  ).trim();
  if (!studentId) return json({ ok: false, message: "studentId is required." }, 400);
  const match = await findStudentRoom(env, studentId);
  if (!match) {
    return json(
      {
        ok: false,
        message: "There is no class open for you right now. Ask your teacher to start the waiting room, then try again.",
      },
      404
    );
  }
  if (!match.displayName) {
    return json({ ok: false, message: "We found a class session but could not identify your student profile." }, 404);
  }
  return json({ ok: true, ...match });
}

async function ownRoom(env, roomId, auth, message) {
  const summary = await roomSummary(env, roomId);
  if (!summary) return json({ message: "Session not found." }, 404);
  if (String(summary.teacherId) !== String(auth.teacherId)) return json({ message }, 403);
  return null;
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function roomIdOf(value) {
  const pin = String(value ?? "").replace(/\D/g, "").slice(0, 6);
  return pin.length === 6 ? pin : "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-room-store": "durable-object" },
  });
}
