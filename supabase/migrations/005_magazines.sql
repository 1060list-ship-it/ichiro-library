-- Phase 5: Weekly magazine table
CREATE TABLE magazines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_label   TEXT UNIQUE NOT NULL,  -- 'YYYY-WNN' e.g. '2026-W20'
  week_start   DATE NOT NULL,
  week_end     DATE NOT NULL,
  content      JSONB NOT NULL,        -- generated magazine content
  stream_ids   UUID[],               -- streams included in this edition
  generated_at TIMESTAMPTZ DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_magazines_week ON magazines(week_label DESC);

ALTER TABLE magazines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "magazines_anon_read" ON magazines
  FOR SELECT TO anon USING (true);

CREATE POLICY "magazines_service_all" ON magazines
  FOR ALL TO service_role USING (true) WITH CHECK (true);
