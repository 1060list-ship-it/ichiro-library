-- like_count（YouTubeいいね数）
ALTER TABLE streams ADD COLUMN IF NOT EXISTS like_count INTEGER;

-- songs（配信中に登場した楽曲名）
ALTER TABLE streams ADD COLUMN IF NOT EXISTS songs TEXT[];

-- talk_topics（対談・トークのテーマ）
ALTER TABLE streams ADD COLUMN IF NOT EXISTS talk_topics TEXT[];

-- インデックス
CREATE INDEX IF NOT EXISTS idx_streams_songs ON streams USING gin(songs);
CREATE INDEX IF NOT EXISTS idx_streams_talk_topics ON streams USING gin(talk_topics);
