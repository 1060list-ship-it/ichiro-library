-- table-level privileges are still present on both roles, so column-only REVOKE is insufficient.
-- Drop excess privileges and re-grant only the public columns.
REVOKE ALL ON streams FROM anon, authenticated;
GRANT SELECT (
  id, video_id, title, stream_date, duration_min, view_count, view_count_7d,
  comment_count, summary, tags, corner_names, guests, youtube_url, thumbnail_url,
  status, channel_id, ai_model, ai_prompt_ver, is_reviewed, avg_rating, rating_count,
  created_at, updated_at, like_count, songs, talk_topics, has_live_singing,
  highlights, has_live_viewing, started_at
) ON streams TO anon, authenticated;

REVOKE ALL ON chapters FROM anon, authenticated;
GRANT SELECT (
  id, stream_id, start_sec, end_sec, title, summary, sort_order, created_at
) ON chapters TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
