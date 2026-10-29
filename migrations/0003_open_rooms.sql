-- Open classroom rooms and the students on each class roster, so a student ID
-- join link can find its room. A room's Durable Object stays the source of its
-- live status; rows for rooms that have ended are removed on close or lookup.
CREATE TABLE IF NOT EXISTS open_rooms (
  room_id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  class_id TEXT,
  class_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_students (
  room_id TEXT NOT NULL,
  student_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY (room_id, student_key)
);

CREATE INDEX IF NOT EXISTS room_students_key ON room_students (student_key);
