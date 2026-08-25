CREATE TABLE checks (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  ping_token TEXT NOT NULL UNIQUE,
  schedule_json TEXT NOT NULL,
  grace_seconds INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'up', 'late', 'down', 'paused')),
  last_ping_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_checks_last_ping_at ON checks (last_ping_at, created_at);
