-- 022: stream_reports table + needs_manual_review / auto_reprocessed_at on streams
-- 視聴者からの「要約が違う」報告を受け取り、閾値で自動再処理・手動レビューフラグを立てる

CREATE TABLE stream_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        TEXT        NOT NULL,
  reported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent      TEXT,
  CONSTRAINT fk_stream_reports_video_id
    FOREIGN KEY (video_id) REFERENCES streams(video_id) ON DELETE CASCADE
);

CREATE INDEX idx_stream_reports_video_id     ON stream_reports(video_id);
CREATE INDEX idx_stream_reports_video_time   ON stream_reports(video_id, reported_at);

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS auto_reprocessed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS needs_manual_review    BOOLEAN NOT NULL DEFAULT false;

-- anon ユーザーは INSERT のみ許可
ALTER TABLE stream_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_can_insert_reports"
  ON stream_reports FOR INSERT
  WITH CHECK (true);
