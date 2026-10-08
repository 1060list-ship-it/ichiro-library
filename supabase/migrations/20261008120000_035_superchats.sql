-- 035: superchats table (投げ銭ランキング試作)
-- yt-dlp live_chat リプレイから抽出したスパチャ/ステッカーを保存する

CREATE TABLE superchats (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id         UUID        NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  video_id          TEXT        NOT NULL REFERENCES streams(video_id) ON DELETE CASCADE,
  item_id           TEXT        NOT NULL,
  author_channel_id TEXT        NOT NULL,
  author_name       TEXT        NOT NULL,
  amount_text       TEXT        NOT NULL,
  amount_value      NUMERIC     NOT NULL,
  currency          TEXT        NOT NULL DEFAULT 'JPY',
  message           TEXT,
  chat_time_ms      BIGINT,
  kind              TEXT        NOT NULL DEFAULT 'paid_message',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(video_id, item_id)
);

CREATE INDEX idx_superchats_stream_id ON superchats(stream_id);
CREATE INDEX idx_superchats_video_id  ON superchats(video_id);
CREATE INDEX idx_superchats_author    ON superchats(author_channel_id);

ALTER TABLE superchats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superchats_public_read"
  ON superchats FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "superchats_service_all"
  ON superchats FOR ALL TO service_role
  USING (true) WITH CHECK (true);
