CREATE OR REPLACE FUNCTION public.get_engagement_ranking(
  limit_n integer DEFAULT 20,
  date_from date DEFAULT NULL,
  date_to date DEFAULT NULL
)
RETURNS SETOF public.streams
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (jsonb_populate_record(
      NULL::public.streams,
      to_jsonb(s) - 'transcript'
    )).*
  FROM public.streams s
  WHERE s.comment_count IS NOT NULL
    AND s.view_count IS NOT NULL
    AND s.view_count > 0
    AND (date_from IS NULL OR s.stream_date >= date_from)
    AND (date_to IS NULL OR s.stream_date < date_to)
  ORDER BY
    (s.comment_count::double precision / s.view_count::double precision) DESC,
    s.comment_count DESC,
    s.view_count DESC,
    s.stream_date DESC
  LIMIT limit_n;
$$;

REVOKE EXECUTE ON FUNCTION public.get_engagement_ranking(integer, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_engagement_ranking(integer, date, date) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
