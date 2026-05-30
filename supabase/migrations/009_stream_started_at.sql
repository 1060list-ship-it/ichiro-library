ALTER TABLE streams ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_streams_started_at ON streams(started_at);
