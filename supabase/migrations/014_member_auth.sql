-- Member auth, playlists, and authenticated read access

-- 1. Fix chapters_anon_read
DROP POLICY IF EXISTS "chapters_anon_read" ON chapters;
CREATE POLICY "chapters_anon_read" ON chapters
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM streams s WHERE s.id = stream_id AND s.status IN ('public', 'unlisted')
  ));

-- 2. Hide transcript columns from authenticated users too
REVOKE SELECT (transcript) ON streams FROM authenticated;
REVOKE SELECT (transcript_segment) ON chapters FROM authenticated;

-- 3. Add authenticated read access to existing public tables
GRANT SELECT ON streams TO authenticated;
GRANT SELECT ON chapters TO authenticated;
GRANT SELECT ON entities TO authenticated;
GRANT SELECT ON stream_entities TO authenticated;
GRANT SELECT ON magazine_entities TO authenticated;
GRANT SELECT ON magazines TO authenticated;
GRANT SELECT ON ratings TO authenticated;
GRANT EXECUTE ON FUNCTION search_streams TO authenticated;

CREATE POLICY "streams_authenticated_read" ON streams
  FOR SELECT TO authenticated
  USING (status IN ('public', 'unlisted'));

CREATE POLICY "chapters_authenticated_read" ON chapters
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM streams s WHERE s.id = stream_id AND s.status IN ('public', 'unlisted')
  ));

CREATE POLICY "entities_authenticated_read" ON entities
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "stream_entities_authenticated_read" ON stream_entities
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "magazine_entities_authenticated_read" ON magazine_entities
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "magazines_authenticated_read" ON magazines
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "ratings_authenticated_read" ON ratings
  FOR SELECT TO authenticated
  USING (true);

-- 4. user_roles
CREATE TABLE user_roles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('editor', 'admin')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON user_roles TO authenticated;

CREATE POLICY "user_roles_self_read" ON user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 5. playlists
CREATE TABLE playlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  created_by  UUID NOT NULL REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER playlists_updated_at
  BEFORE UPDATE ON playlists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

GRANT SELECT ON playlists TO anon, authenticated;

CREATE POLICY "playlists_public_read" ON playlists
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "playlists_authenticated_read" ON playlists
  FOR SELECT TO authenticated
  USING (true);

-- 6. playlist_streams
CREATE TABLE playlist_streams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  stream_id   UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  position    NUMERIC(18,8) NOT NULL,
  added_by    UUID REFERENCES auth.users(id),
  added_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (playlist_id, position) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (playlist_id, stream_id)
);

ALTER TABLE playlist_streams ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON playlist_streams TO anon, authenticated;

CREATE POLICY "playlist_streams_public_read" ON playlist_streams
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "playlist_streams_authenticated_read" ON playlist_streams
  FOR SELECT TO authenticated
  USING (true);

-- 7. bookmarks
CREATE TABLE bookmarks (
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stream_id  UUID REFERENCES streams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, stream_id)
);

ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_bookmarks_stream ON bookmarks(stream_id);

GRANT SELECT, INSERT, DELETE ON bookmarks TO authenticated;

CREATE POLICY "bookmarks_self_access" ON bookmarks
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()));

-- 8. entity_word_requests
CREATE TABLE entity_word_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    UUID NOT NULL REFERENCES entities(id),
  word         TEXT NOT NULL CHECK (word <> '' AND word = TRIM(word)),
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID REFERENCES auth.users(id),
  reviewed_by  UUID REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);

ALTER TABLE entity_word_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON entity_word_requests TO authenticated;
GRANT INSERT ON entity_word_requests TO authenticated;

CREATE POLICY "entity_word_requests_read" ON entity_word_requests
  FOR SELECT TO authenticated
  USING (
    (requested_by = auth.uid() AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()))
    OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

CREATE POLICY "entity_word_requests_insert" ON entity_word_requests
  FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()));

CREATE UNIQUE INDEX entity_word_requests_pending_unique
  ON entity_word_requests (entity_id, word)
  WHERE status = 'pending';

-- 9. Replace search_streams with 10-arg version
DROP FUNCTION IF EXISTS public.search_streams(
  TEXT, DATE, DATE, TEXT[], TEXT[], TEXT[], TEXT, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION search_streams(
  query            TEXT,
  date_from        DATE    DEFAULT NULL,
  date_to          DATE    DEFAULT NULL,
  filter_tags      TEXT[]  DEFAULT NULL,
  filter_corners   TEXT[]  DEFAULT NULL,
  filter_guests    TEXT[]  DEFAULT NULL,
  sort_by          TEXT    DEFAULT 'date_desc',
  page_num         INTEGER DEFAULT 1,
  page_size        INTEGER DEFAULT 20,
  filter_entity_id UUID    DEFAULT NULL
)
RETURNS TABLE (
  id            UUID,
  video_id      TEXT,
  title         TEXT,
  stream_date   DATE,
  duration_min  INTEGER,
  view_count    INTEGER,
  summary       TEXT,
  tags          TEXT[],
  corner_names  TEXT[],
  guests        TEXT[],
  youtube_url   TEXT,
  thumbnail_url TEXT,
  avg_rating    NUMERIC,
  rating_count  INTEGER,
  total_count   BIGINT
) AS $$
DECLARE
  offset_val INTEGER := (page_num - 1) * page_size;
BEGIN
  RETURN QUERY
  WITH matched AS (
    SELECT s.id
    FROM streams s
    WHERE
      s.status IN ('public', 'unlisted')
      AND (query IS NULL OR query = '' OR (
        s.title            ILIKE '%' || query || '%'
        OR s.summary       ILIKE '%' || query || '%'
        OR s.transcript    ILIKE '%' || query || '%'
        OR EXISTS (
          SELECT 1 FROM chapters c
          WHERE c.stream_id = s.id
            AND (
              c.title              ILIKE '%' || query || '%'
              OR c.transcript_segment ILIKE '%' || query || '%'
            )
        )
      ))
      AND (date_from        IS NULL OR s.stream_date >= date_from)
      AND (date_to          IS NULL OR s.stream_date <= date_to)
      AND (filter_tags      IS NULL OR s.tags         @> filter_tags)
      AND (filter_corners   IS NULL OR s.corner_names @> filter_corners)
      AND (filter_guests    IS NULL OR s.guests       @> filter_guests)
      AND (filter_entity_id IS NULL OR EXISTS (
        SELECT 1 FROM stream_entities se
        WHERE se.stream_id = s.id AND se.entity_id = filter_entity_id
      ))
  ),
  total AS (SELECT COUNT(*) AS cnt FROM matched)
  SELECT
    s.id,
    s.video_id,
    s.title,
    s.stream_date,
    s.duration_min,
    s.view_count,
    s.summary,
    s.tags,
    s.corner_names,
    s.guests,
    s.youtube_url,
    s.thumbnail_url,
    s.avg_rating,
    s.rating_count,
    t.cnt AS total_count
  FROM streams s
  JOIN matched m ON s.id = m.id
  CROSS JOIN total t
  ORDER BY
    CASE WHEN sort_by = 'date_desc'  THEN s.stream_date END DESC,
    CASE WHEN sort_by = 'date_asc'   THEN s.stream_date END ASC,
    CASE WHEN sort_by = 'view_count' THEN s.view_count  END DESC NULLS LAST,
    CASE WHEN sort_by = 'rating'     THEN s.avg_rating  END DESC NULLS LAST,
    s.stream_date DESC
  LIMIT page_size OFFSET offset_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION search_streams TO anon;
GRANT EXECUTE ON FUNCTION search_streams TO authenticated;

-- 10. search_logs
CREATE TABLE search_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query        TEXT,
  result_count INTEGER,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  searched_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON search_logs TO authenticated;

CREATE POLICY "search_logs_admin_read" ON search_logs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- INSERT is service_role only
