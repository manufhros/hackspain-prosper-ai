CREATE TABLE IF NOT EXISTS voice_calls (
  call_id TEXT PRIMARY KEY,
  org_slug TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT CHECK (summary IS NULL OR json_valid(summary))
);
CREATE INDEX IF NOT EXISTS voice_calls_started_at ON voice_calls (started_at);

CREATE TABLE IF NOT EXISTS voice_sessions (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS voice_sessions_expires_at ON voice_sessions (expires_at);
