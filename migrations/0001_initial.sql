CREATE TABLE monitors (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'healthy', 'down')),
  last_checked_at INTEGER,
  last_status_code INTEGER,
  last_latency_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_monitors_last_checked_at
  ON monitors (last_checked_at, created_at);
