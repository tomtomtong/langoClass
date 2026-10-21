-- One row per teacher + class + room + exercise + student. Rooms insert with
-- INSERT OR IGNORE, so a retried save never counts a score twice.
CREATE TABLE IF NOT EXISTS score_records (
  record_key TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  class_id INTEGER NOT NULL,
  saved_at TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS score_records_class ON score_records (teacher_id, class_id, saved_at);
