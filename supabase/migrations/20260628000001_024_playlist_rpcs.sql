CREATE OR REPLACE FUNCTION public.reorder_playlist_stream(
  p_playlist_id uuid,
  p_stream_id uuid,
  p_new_position numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_min_gap numeric;
BEGIN
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_position IS NULL THEN
    RAISE EXCEPTION 'new_position is required'
      USING ERRCODE = '22004';
  END IF;

  PERFORM 1
  FROM public.user_roles ur
  WHERE ur.user_id = v_actor_id
    AND ur.role IN ('editor', 'admin');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM ps.id
  FROM public.playlist_streams ps
  WHERE ps.playlist_id = p_playlist_id
  ORDER BY ps.position
  FOR UPDATE;

  PERFORM 1
  FROM public.playlist_streams ps
  WHERE ps.playlist_id = p_playlist_id
    AND ps.stream_id = p_stream_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'playlist_stream not found: playlist_id=%, stream_id=%', p_playlist_id, p_stream_id
      USING ERRCODE = 'P0002';
  END IF;

  WITH ordered AS (
    SELECT
      ps.position,
      lead(ps.position) OVER (ORDER BY ps.position) AS next_position
    FROM public.playlist_streams ps
    WHERE ps.playlist_id = p_playlist_id
  )
  SELECT min(next_position - position)
  INTO v_min_gap
  FROM ordered
  WHERE next_position IS NOT NULL;

  IF v_min_gap IS NOT NULL AND v_min_gap <= 0.00000002::numeric THEN
    WITH rebalanced AS (
      SELECT
        ps.id,
        row_number() OVER (
          ORDER BY
            CASE
              WHEN ps.stream_id = p_stream_id THEN p_new_position
              ELSE ps.position
            END,
            CASE
              WHEN ps.stream_id = p_stream_id THEN 1
              ELSE 0
            END,
            ps.id
        )::numeric * 10000::numeric AS new_position
      FROM public.playlist_streams ps
      WHERE ps.playlist_id = p_playlist_id
    )
    UPDATE public.playlist_streams ps
    SET position = rebalanced.new_position
    FROM rebalanced
    WHERE ps.id = rebalanced.id;
  ELSE
    UPDATE public.playlist_streams ps
    SET position = p_new_position
    WHERE ps.playlist_id = p_playlist_id
      AND ps.stream_id = p_stream_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reorder_playlist_stream(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_playlist_stream(uuid, uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
