-- Align the song preview with packages/pipeline/extract_entities.py and
-- persist the optional entity role when creating a song entity.

CREATE OR REPLACE FUNCTION preview_song_matches(p_match_names TEXT[])
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
STABLE AS $$
DECLARE
  v_total INTEGER;
  v_top   JSONB;
  v_aliases TEXT[];
BEGIN
  SELECT array_agg(alias) INTO v_aliases
  FROM unnest(p_match_names) alias
  WHERE length(alias) >= 3;

  IF v_aliases IS NULL OR array_length(v_aliases, 1) IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'top', '[]'::jsonb);
  END IF;

  SELECT (
    SELECT count(*)
    FROM streams s
    WHERE EXISTS (
      SELECT 1 FROM unnest(v_aliases) alias
      WHERE s.title LIKE '%' || alias || '%'
         OR coalesce(s.summary, '') LIKE '%' || alias || '%'
         OR coalesce(array_to_string(s.talk_topics, E'\n'), '') LIKE '%' || alias || '%'
         OR coalesce(array_to_string(s.guests, E'\n'), '') LIKE '%' || alias || '%'
         OR coalesce(array_to_string(s.songs, E'\n'), '') LIKE '%' || alias || '%'
         OR coalesce(s.highlights::text, '') LIKE '%' || alias || '%'
    )
  ) + (
    SELECT count(*)
    FROM magazines m
    WHERE EXISTS (
      SELECT 1 FROM unnest(v_aliases) alias
      WHERE m.content::text LIKE '%' || alias || '%'
    )
  ) INTO v_total;

  SELECT jsonb_agg(jsonb_build_object(
    'stream_id', t.id,
    'video_id', t.video_id,
    'title', t.title,
    'stream_date', t.stream_date
  )) INTO v_top
  FROM (
    SELECT s.id, s.video_id, s.title, s.stream_date
    FROM streams s
    WHERE EXISTS (
      SELECT 1 FROM unnest(v_aliases) alias
      WHERE s.title LIKE '%' || alias || '%'
         OR coalesce(s.summary, '') LIKE '%' || alias || '%'
         OR coalesce(array_to_string(s.talk_topics, E'\n'), '') LIKE '%' || alias || '%'
         OR coalesce(array_to_string(s.guests, E'\n'), '') LIKE '%' || alias || '%'
         OR coalesce(array_to_string(s.songs, E'\n'), '') LIKE '%' || alias || '%'
         OR coalesce(s.highlights::text, '') LIKE '%' || alias || '%'
    )
    ORDER BY s.stream_date DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object('total', v_total, 'top', coalesce(v_top, '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION preview_song_matches(TEXT[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION preview_song_matches(TEXT[])
  TO service_role;

-- PostgreSQL function identity includes its argument types, so adding a
-- parameter requires replacing the old 13-argument signature explicitly.
DROP FUNCTION create_song_entity(
  UUID, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION create_song_entity(
  p_song_id             UUID,
  p_song_title          TEXT,
  p_song_album          TEXT,
  p_song_disc_no        INTEGER,
  p_song_track_no       INTEGER,
  p_song_released_at    DATE,
  p_song_notes          TEXT,
  p_entity_slug         TEXT,
  p_entity_name         TEXT,
  p_entity_match_names  TEXT[],
  p_entity_description  TEXT,
  p_entity_related_work TEXT,
  p_entity_external_url TEXT,
  p_entity_role         TEXT DEFAULT NULL
) RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_song_id         UUID;
  v_entity_id       UUID;
  v_constraint_name TEXT;
BEGIN
  IF p_entity_match_names IS NULL
     OR NOT EXISTS (SELECT 1 FROM unnest(p_entity_match_names) alias WHERE length(alias) >= 3) THEN
    RAISE EXCEPTION 'match_names_too_short' USING ERRCODE = 'P0001';
  END IF;

  IF p_song_id IS NOT NULL THEN
    SELECT id INTO v_song_id FROM songs WHERE id = p_song_id;
    IF v_song_id IS NULL THEN
      RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF p_song_title IS NULL OR length(trim(p_song_title)) = 0 THEN
      RAISE EXCEPTION 'song_title_required' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO songs (title, album, disc_no, track_no, released_at, notes)
    VALUES (trim(p_song_title), p_song_album, p_song_disc_no, p_song_track_no, p_song_released_at, p_song_notes)
    RETURNING id INTO v_song_id;
  END IF;

  BEGIN
    INSERT INTO entities (
      slug, name, match_names, category, role, description, related_work, external_url, song_id
    ) VALUES (
      p_entity_slug, p_entity_name, p_entity_match_names, 'song', p_entity_role,
      p_entity_description, p_entity_related_work, p_entity_external_url, v_song_id
    )
    RETURNING id INTO v_entity_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name = 'entities_song_id_key' THEN
        RAISE EXCEPTION 'song_already_has_entity' USING ERRCODE = 'P0001';
      ELSE
        RAISE EXCEPTION 'slug_already_exists' USING ERRCODE = 'P0001';
      END IF;
  END;

  RETURN v_entity_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_song_entity(
  UUID, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_song_entity(
  UUID, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
