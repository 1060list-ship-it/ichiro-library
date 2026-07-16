-- supabase/migrations/20260713120000_030_song_entities_schema.sql
-- 楽曲entity登録機能: entities と songs を song_id で連携する

ALTER TABLE entities
  ADD COLUMN song_id UUID REFERENCES songs(id) ON DELETE RESTRICT;

ALTER TABLE entities
  ADD CONSTRAINT entities_song_id_key UNIQUE (song_id);

ALTER TABLE entities
  ADD CONSTRAINT entities_song_category_consistency
  CHECK (
    (category = 'song' AND song_id IS NOT NULL)
    OR (category <> 'song' AND song_id IS NULL)
  );

CREATE INDEX idx_entities_song_id ON entities(song_id);
