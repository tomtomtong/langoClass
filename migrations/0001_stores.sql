CREATE TABLE IF NOT EXISTS documents (
  name TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  category TEXT NOT NULL,
  level TEXT,
  body TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS app_logs_created_at ON app_logs (created_at);
CREATE INDEX IF NOT EXISTS app_logs_category ON app_logs (category);
