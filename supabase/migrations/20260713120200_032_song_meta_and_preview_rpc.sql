-- 楽曲entity登録機能: songメタデータ更新とマッチプレビュー用RPC

CREATE OR REPLACE FUNCTION update_song_meta(
  p_song_id     UUID,
  p_title       TEXT,
  p_album       TEXT,
  p_disc_no     INTEGER,
  p_track_no    INTEGER,
  p_released_at DATE,
  p_notes       TEXT
) RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE songs
  SET title = p_title,
      album = p_album,
      disc_no = p_disc_no,
      track_no = p_track_no,
      released_at = p_released_at,
      notes = p_notes
  WHERE id = p_song_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_song_meta(UUID, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION update_song_meta(UUID, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT)
  TO service_role;

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
      WHERE coalesce(s.summary, '') ILIKE '%' || alias || '%'
         OR coalesce(s.transcript, '') ILIKE '%' || alias || '%'
         OR coalesce(s.highlights::text, '') ILIKE '%' || alias || '%'
    )
  ) + (
    SELECT count(*)
    FROM magazines m
    WHERE EXISTS (
      SELECT 1 FROM unnest(v_aliases) alias
      WHERE m.content::text ILIKE '%' || alias || '%'
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
      WHERE coalesce(s.summary, '') ILIKE '%' || alias || '%'
         OR coalesce(s.transcript, '') ILIKE '%' || alias || '%'
         OR coalesce(s.highlights::text, '') ILIKE '%' || alias || '%'
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

NOTIFY pgrst, 'reload schema';
