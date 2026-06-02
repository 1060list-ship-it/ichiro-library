-- pipeline_jobs.kind に weekly_magazine を追加
ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_kind_check;
ALTER TABLE pipeline_jobs
  ADD CONSTRAINT pipeline_jobs_kind_check
  CHECK (kind IN ('fetch_new', 'reprocess', 'reprocess_single', 'weekly_magazine'));
