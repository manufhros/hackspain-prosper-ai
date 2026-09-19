-- Conversation text is retained separately from redacted diagnostic events.
-- No foreign key: conversation and lifecycle events can arrive out of order.
CREATE TABLE IF NOT EXISTS voice_transcript_entries (
  event_id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  org_slug TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('caller', 'agent')),
  text TEXT NOT NULL CHECK (length(trim(text)) > 0)
);
CREATE INDEX IF NOT EXISTS voice_transcript_call_order
  ON voice_transcript_entries (org_slug, call_id, sequence, occurred_at, event_id);
