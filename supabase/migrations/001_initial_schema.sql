-- Phase 1: Initial schema for ichiro-library
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- Trigram extension for Japanese-friendly full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- TABLE: streams
-- ============================================================
CREATE TABLE streams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  stream_date     DATE NOT NULL,
  duration_min    INTEGER,
  view_count      INTEGER,
  view_count_7d   INTEGER,
  comment_count   INTEGER,
  summary         TEXT,
  tags            TEXT[],
  corner_names    TEXT[],
  guests          TEXT[],
  transcript      TEXT,
  youtube_url     TEXT,
  thumbnail_url   TEXT,
  status          TEXT DEFAULT 'public',
  channel_id      TEXT DEFAULT 'ichiroyamaguchichannel',
  ai_model        TEXT,
  ai_prompt_ver   TEXT,
  is_reviewed     BOOLEAN DEFAULT false,
  avg_rating      NUMERIC(2,1) DEFAULT 0,
  rating_count    INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_streams_title_trgm      ON streams USING gin(title gin_trgm_ops);
CREATE INDEX idx_streams_summary_trgm    ON streams USING gin(summary gin_trgm_ops);
CREATE INDEX idx_streams_transcript_trgm ON streams USING gin(transcript gin_trgm_ops);
CREATE INDEX idx_streams_tags            ON streams USING gin(tags);
CREATE INDEX idx_streams_corner_names    ON streams USING gin(corner_names);
CREATE INDEX idx_streams_guests          ON streams USING gin(guests);
CREATE INDEX idx_streams_date            ON streams(stream_date DESC);
CREATE INDEX idx_streams_status          ON streams(status);

-- ============================================================
-- TABLE: chapters
-- ============================================================
CREATE TABLE chapters (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id          UUID REFERENCES streams(id) ON DELETE CASCADE,
  start_sec          INTEGER NOT NULL,
  end_sec            INTEGER,
  title              TEXT NOT NULL,
  summary            TEXT,
  transcript_segment TEXT,
  sort_order         INTEGER NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chapters_stream        ON chapters(stream_id);
CREATE INDEX idx_chapters_sort          ON chapters(stream_id, sort_order);
CREATE INDEX idx_chapters_segment_trgm  ON chapters USING gin(transcript_segment gin_trgm_ops);

-- ============================================================
-- TABLE: ratings
-- ============================================================
CREATE TABLE ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   UUID REFERENCES streams(id) ON DELETE CASCADE,
  user_hash   TEXT NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stream_id, user_hash)
);

CREATE INDEX idx_ratings_stream ON ratings(stream_id);

-- ============================================================
-- TRIGGER: auto-update updated_at on streams
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER streams_updated_at
  BEFORE UPDATE ON streams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TRIGGER: recalculate avg_rating / rating_count on streams
-- ============================================================
CREATE OR REPLACE FUNCTION sync_stream_rating()
RETURNS TRIGGER AS $$
DECLARE
  target_stream_id UUID;
BEGIN
  target_stream_id := COALESCE(NEW.stream_id, OLD.stream_id);

  UPDATE streams
  SET
    avg_rating   = COALESCE((SELECT AVG(rating)::NUMERIC(2,1) FROM ratings WHERE stream_id = target_stream_id), 0),
    rating_count = (SELECT COUNT(*)::INTEGER FROM ratings WHERE stream_id = target_stream_id)
  WHERE id = target_stream_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ratings_sync_stream
  AFTER INSERT OR UPDATE OR DELETE ON ratings
  FOR EACH ROW EXECUTE FUNCTION sync_stream_rating();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE streams  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings  ENABLE ROW LEVEL SECURITY;

-- streams: public users can read non-deleted streams
CREATE POLICY "streams_anon_read" ON streams
  FOR SELECT TO anon
  USING (status IN ('public', 'unlisted'));

-- chapters: public users can read all chapters
CREATE POLICY "chapters_anon_read" ON chapters
  FOR SELECT TO anon
  USING (true);

-- ratings: public users can read and insert
CREATE POLICY "ratings_anon_read" ON ratings
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "ratings_anon_insert" ON ratings
  FOR INSERT TO anon
  WITH CHECK (true);

-- service_role bypasses RLS (Supabase default), but add explicit policies for clarity
CREATE POLICY "streams_service_all"  ON streams  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapters_service_all" ON chapters FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "ratings_service_all"  ON ratings  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Hide raw transcript columns from anonymous users (column-level privilege)
-- NOTE: Run these AFTER enabling RLS. Supabase anon role must not see raw transcript.
REVOKE SELECT (transcript)         ON streams  FROM anon;
REVOKE SELECT (transcript_segment) ON chapters FROM anon;

-- ============================================================
-- RPC: search_streams
-- Runs as SECURITY DEFINER to access transcript for matching
-- without exposing it to the client.
-- ============================================================
CREATE OR REPLACE FUNCTION search_streams(
  query        TEXT,
  date_from    DATE    DEFAULT NULL,
  date_to      DATE    DEFAULT NULL,
  filter_tags  TEXT[]  DEFAULT NULL,
  filter_corners TEXT[] DEFAULT NULL,
  filter_guests  TEXT[] DEFAULT NULL,
  sort_by      TEXT    DEFAULT 'date_desc',
  page_num     INTEGER DEFAULT 1,
  page_size    INTEGER DEFAULT 20
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
      AND (date_from    IS NULL OR s.stream_date >= date_from)
      AND (date_to      IS NULL OR s.stream_date <= date_to)
      AND (filter_tags    IS NULL OR s.tags        @> filter_tags)
      AND (filter_corners IS NULL OR s.corner_names @> filter_corners)
      AND (filter_guests  IS NULL OR s.guests       @> filter_guests)
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
    CASE WHEN sort_by = 'date_desc'    THEN s.stream_date   END DESC,
    CASE WHEN sort_by = 'date_asc'     THEN s.stream_date   END ASC,
    CASE WHEN sort_by = 'view_count'   THEN s.view_count    END DESC NULLS LAST,
    CASE WHEN sort_by = 'rating'       THEN s.avg_rating    END DESC NULLS LAST,
    s.stream_date DESC
  LIMIT page_size OFFSET offset_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to anon (search goes through this RPC, not direct table access)
GRANT EXECUTE ON FUNCTION search_streams TO anon;
