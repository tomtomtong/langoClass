// Which rooms are open and which students each one expects, in D1. Room codes
// are claimed here so two classes never share one, and a student ID join link
// finds the newest open room on that student's roster.
import { studentKeys } from "./classes.js";

const CLAIM_ATTEMPTS = 25;
const LOOKUP_CANDIDATES = 5;

// Claims an unused six-digit code. A code left behind by a room that already
// ended is reclaimed.
export async function claimRoomId(env, { teacherId, classId, className, now = Date.now(), random = Math.random }) {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const roomId = String(Math.floor(100000 + random() * 900000));
    if (await insertRoom(env, roomId, { teacherId, classId, className, now })) return roomId;
    if (await roomIsOpen(env, roomId)) continue;
    await removeRoom(env, roomId);
    if (await insertRoom(env, roomId, { teacherId, classId, className, now })) return roomId;
  }
  throw new Error("Could not find a free room code.");
}

export async function indexStudents(env, roomId, studentList, className) {
  const statements = [env.DB.prepare("DELETE FROM room_students WHERE room_id = ?").bind(roomId)];
  const insert = env.DB.prepare(
    "INSERT OR IGNORE INTO room_students (room_id, student_key, user_id, display_name) VALUES (?, ?, ?, ?)"
  );
  for (const student of studentList || []) {
    const displayName = String(student.fullName || "").trim().slice(0, 40);
    for (const key of studentKeys(student)) {
      statements.push(insert.bind(roomId, key, String(student.id), displayName));
    }
  }
  if (className) {
    statements.push(env.DB.prepare("UPDATE open_rooms SET class_name = ? WHERE room_id = ?").bind(String(className).slice(0, 200), roomId));
  }
  await env.DB.batch(statements);
}

export async function removeRoom(env, roomId) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM room_students WHERE room_id = ?").bind(roomId),
    env.DB.prepare("DELETE FROM open_rooms WHERE room_id = ?").bind(roomId),
  ]);
}

// The newest open room whose roster has this student, as server.js
// findOpenSessionForStudent returned it.
export async function findStudentRoom(env, rawStudentId) {
  const key = String(rawStudentId ?? "").trim().toLowerCase();
  if (!key) return null;
  const { results } = await env.DB.prepare(
    `SELECT s.room_id, s.user_id, s.display_name, r.class_name
       FROM room_students s JOIN open_rooms r ON r.room_id = s.room_id
      WHERE s.student_key = ?
      ORDER BY r.created_at DESC
      LIMIT ?`
  )
    .bind(key, LOOKUP_CANDIDATES)
    .all();
  for (const row of results || []) {
    const summary = await roomSummary(env, row.room_id);
    if (!summary || summary.status === "ended") {
      await removeRoom(env, row.room_id);
      continue;
    }
    return {
      roomId: row.room_id,
      userId: row.user_id,
      displayName: row.display_name,
      className: summary.className || row.class_name || "",
      sessionStatus: summary.status,
    };
  }
  return null;
}

export async function roomSummary(env, roomId) {
  return env.ROOM.getByName(roomId).read();
}

async function roomIsOpen(env, roomId) {
  const summary = await roomSummary(env, roomId);
  return !!summary && summary.status !== "ended";
}

async function insertRoom(env, roomId, { teacherId, classId, className, now }) {
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO open_rooms (room_id, teacher_id, class_id, class_name, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(roomId, String(teacherId), classId == null ? null : String(classId), String(className || "").slice(0, 200), now)
    .run();
  return Number(result?.meta?.changes) === 1;
}
