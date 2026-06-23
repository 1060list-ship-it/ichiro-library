-- Fix 1: streams - revoke table-level SELECT, re-grant per-column (excluding transcript)
REVOKE SELECT ON streams FROM anon, authenticated;
GRANT SELECT (
  id, video_id, title, stream_date, duration_min, view_count, view_count_7d,
  comment_count, summary, tags, corner_names, guests, youtube_url, thumbnail_url,
  status, channel_id, ai_model, ai_prompt_ver, is_reviewed, avg_rating, rating_count,
  created_at, updated_at, like_count, songs, talk_topics, has_live_singing,
  highlights, has_live_viewing, started_at
) ON streams TO anon, authenticated;

-- Fix 2: chapters - revoke table-level SELECT, re-grant per-column (excluding transcript_segment)
REVOKE SELECT ON chapters FROM anon, authenticated;
GRANT SELECT (
  id, stream_id, start_sec, end_sec, title, summary, sort_order, created_at
) ON chapters TO anon, authenticated;

-- Fix 3: bookmarks - revoke anon all privileges (Supabase default grants anon everything)
REVOKE ALL ON bookmarks FROM anon;
GRANT SELECT, INSERT, DELETE ON bookmarks TO authenticated;

-- Fix 4: entity_word_requests - revoke anon all privileges
REVOKE ALL ON entity_word_requests FROM anon;
GRANT SELECT, INSERT ON entity_word_requests TO authenticated;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
