CREATE TABLE pipeline_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('fetch_new', 'reprocess', 'reprocess_single')),
  video_id TEXT,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  error_msg TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_pipeline_jobs_pending
  ON pipeline_jobs(status, requested_at)
  WHERE status = 'pending';

ALTER TABLE pipeline_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_jobs_service_all" ON pipeline_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
