-- Playlist entity linkage, search log hardening, and playlist stream RLS tightening

-- 1. playlist_entities
CREATE TABLE playlist_entities (
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  entity_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (playlist_id, entity_id)
);

ALTER TABLE playlist_entities ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON playlist_entities TO anon, authenticated;

CREATE POLICY "playlist_entities_public_read" ON playlist_entities
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1
    FROM playlists p
    WHERE p.id = playlist_id
  ));

CREATE POLICY "playlist_entities_authenticated_read" ON playlist_entities
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM playlists p
    WHERE p.id = playlist_id
  ));

-- 2. search_logs
-- search_logs was introduced in 014_member_auth.sql. Tighten it here instead of recreating it.
UPDATE search_logs
SET
  query = COALESCE(query, ''),
  result_count = COALESCE(result_count, 0)
WHERE query IS NULL OR result_count IS NULL;

ALTER TABLE search_logs
  ALTER COLUMN query SET NOT NULL,
  ALTER COLUMN result_count SET NOT NULL,
  ALTER COLUMN searched_at SET DEFAULT now();

GRANT SELECT ON search_logs TO authenticated;

DROP POLICY IF EXISTS "search_logs_admin_read" ON search_logs;

CREATE POLICY "search_logs_admin_read" ON search_logs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- 3. playlist_streams RLS
DROP POLICY IF EXISTS "playlist_streams_public_read" ON playlist_streams;
DROP POLICY IF EXISTS "playlist_streams_authenticated_read" ON playlist_streams;

CREATE POLICY "playlist_streams_public_read" ON playlist_streams
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1
    FROM playlists p
    WHERE p.id = playlist_id
  ));

CREATE POLICY "playlist_streams_authenticated_read" ON playlist_streams
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM playlists p
    WHERE p.id = playlist_id
  ));
