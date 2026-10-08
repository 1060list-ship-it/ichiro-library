-- 036: superchat ranking RPCs (集計はDB側で行う)

CREATE OR REPLACE FUNCTION superchat_ranking_all(
  sort_by TEXT DEFAULT 'amount',
  limit_n INTEGER DEFAULT 50
)
RETURNS TABLE (
  author_channel_id TEXT,
  author_name TEXT,
  event_count BIGINT,
  total_jpy NUMERIC
) AS $$
  SELECT
    s.author_channel_id,
    MAX(s.author_name),
    COUNT(*),
    COALESCE(SUM(s.amount_value) FILTER (WHERE s.currency = 'JPY'), 0)
  FROM superchats s
  GROUP BY s.author_channel_id
  ORDER BY
    CASE WHEN sort_by = 'count' THEN COUNT(*) END DESC,
    CASE WHEN sort_by <> 'count' THEN COALESCE(SUM(s.amount_value) FILTER (WHERE s.currency = 'JPY'), 0) END DESC
  LIMIT limit_n;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION superchat_ranking_by_video(
  target_video_id TEXT,
  sort_by TEXT DEFAULT 'amount',
  limit_n INTEGER DEFAULT 50
)
RETURNS TABLE (
  author_channel_id TEXT,
  author_name TEXT,
  event_count BIGINT,
  total_jpy NUMERIC
) AS $$
  SELECT
    s.author_channel_id,
    MAX(s.author_name),
    COUNT(*),
    COALESCE(SUM(s.amount_value) FILTER (WHERE s.currency = 'JPY'), 0)
  FROM superchats s
  WHERE s.video_id = target_video_id
  GROUP BY s.author_channel_id
  ORDER BY
    CASE WHEN sort_by = 'count' THEN COUNT(*) END DESC,
    CASE WHEN sort_by <> 'count' THEN COALESCE(SUM(s.amount_value) FILTER (WHERE s.currency = 'JPY'), 0) END DESC
  LIMIT limit_n;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION superchat_video_stats()
RETURNS TABLE (
  video_id TEXT,
  event_count BIGINT,
  author_count BIGINT,
  total_jpy NUMERIC
) AS $$
  SELECT
    s.video_id,
    COUNT(*),
    COUNT(DISTINCT s.author_channel_id),
    COALESCE(SUM(s.amount_value) FILTER (WHERE s.currency = 'JPY'), 0)
  FROM superchats s
  GROUP BY s.video_id
  ORDER BY COUNT(*) DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION superchat_ranking_all TO anon, authenticated;
GRANT EXECUTE ON FUNCTION superchat_ranking_by_video TO anon, authenticated;
GRANT EXECUTE ON FUNCTION superchat_video_stats TO anon, authenticated;
