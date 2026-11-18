-- スーパーチャット（視聴者データ）を管理者限定に変更。
-- 一般公開に伴い、興味本位の集計ページを公開対象から外すため。
-- テーブルは admin ロールのみ SELECT 可、RPC は authenticated に EXECUTE を残しつつ
-- 関数内で admin ロールを検査する（SECURITY DEFINER のため関数内検査が必須）。
-- service_role は既存の superchats_service_all ポリシーと関数 EXECUTE（PUBLIC 経由）で
-- パイプライン書き込み・検証用途を維持する。

DROP POLICY IF EXISTS "superchats_public_read" ON public.superchats;
CREATE POLICY "superchats_admin_read" ON public.superchats
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ));

REVOKE EXECUTE ON FUNCTION public.superchat_ranking_all(TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.superchat_ranking_by_video(TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.superchat_video_stats() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.superchat_ranking_all(
  sort_by TEXT DEFAULT 'amount',
  limit_n INTEGER DEFAULT 50
)
RETURNS TABLE (
  author_channel_id TEXT,
  author_name TEXT,
  event_count BIGINT,
  total_jpy NUMERIC
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'superchat_ranking_all is restricted to admin role';
  END IF;
  RETURN QUERY
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.superchat_ranking_by_video(
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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'superchat_ranking_by_video is restricted to admin role';
  END IF;
  RETURN QUERY
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.superchat_video_stats()
RETURNS TABLE (
  video_id TEXT,
  event_count BIGINT,
  author_count BIGINT,
  total_jpy NUMERIC
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'superchat_video_stats is restricted to admin role';
  END IF;
  RETURN QUERY
  SELECT
    s.video_id,
    COUNT(*),
    COUNT(DISTINCT s.author_channel_id),
    COALESCE(SUM(s.amount_value) FILTER (WHERE s.currency = 'JPY'), 0)
  FROM superchats s
  GROUP BY s.video_id
  ORDER BY COUNT(*) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.superchat_ranking_all(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superchat_ranking_by_video(TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superchat_video_stats() TO authenticated;
