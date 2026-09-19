CREATE TABLE IF NOT EXISTS agent_events (
  event_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  config_version TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE INDEX IF NOT EXISTS agent_events_call_time ON agent_events (call_id, occurred_at);
CREATE INDEX IF NOT EXISTS agent_events_type_time ON agent_events (type, occurred_at);
