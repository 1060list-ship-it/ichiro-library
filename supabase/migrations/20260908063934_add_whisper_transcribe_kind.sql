-- Candidate only; do not apply directly to production without owner approval.
-- Existing four kinds are preserved; whisper_transcribe is the only addition.
ALTER TABLE public.pipeline_jobs
  DROP CONSTRAINT IF EXISTS pipeline_jobs_kind_check;

ALTER TABLE public.pipeline_jobs
  ADD CONSTRAINT pipeline_jobs_kind_check
  CHECK (kind IN (
    'fetch_new',
    'reprocess',
    'reprocess_single',
    'weekly_magazine',
    'whisper_transcribe'
  ));