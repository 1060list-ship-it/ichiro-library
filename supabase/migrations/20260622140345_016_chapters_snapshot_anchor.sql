ALTER TABLE public.chapters
  ADD COLUMN snapshot_id UUID,
  ADD COLUMN snippet_index INTEGER,
  ADD COLUMN ai_start_sec INTEGER,
  ADD COLUMN snap_delta_sec INTEGER,
  ADD COLUMN snap_status TEXT NOT NULL DEFAULT 'legacy';

COMMENT ON COLUMN public.chapters.snapshot_id IS
  'この chapter の snippet_index がどの transcript_snapshot を参照しているかを固定する FK。';

COMMENT ON COLUMN public.chapters.snippet_index IS
  'AI が返した秒数を transcript_snapshots.snippets にスナップした結果の 0-based 添字。';

COMMENT ON COLUMN public.chapters.ai_start_sec IS
  'Gemini が返した元の秒数。スナップ前の値。';

COMMENT ON COLUMN public.chapters.snap_delta_sec IS
  'abs(ai_start_sec - start_sec)。スナップ補正量。';

COMMENT ON COLUMN public.chapters.snap_status IS
  'legacy / ok / warn / review / drop。legacy は旧データ。';

COMMENT ON COLUMN public.chapters.start_sec IS
  '公開用の開始秒。transcript_snapshots.snippets[snippet_index].start から pipeline が導出して保存する。';

ALTER TABLE public.chapters
  ADD CONSTRAINT chapters_snapshot_fk
    FOREIGN KEY (snapshot_id)
    REFERENCES public.transcript_snapshots(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT chapters_snippet_index_nonnegative
    CHECK (snippet_index IS NULL OR snippet_index >= 0),
  ADD CONSTRAINT chapters_ai_start_sec_nonnegative
    CHECK (ai_start_sec IS NULL OR ai_start_sec >= 0),
  ADD CONSTRAINT chapters_snap_delta_sec_nonnegative
    CHECK (snap_delta_sec IS NULL OR snap_delta_sec >= 0),
  ADD CONSTRAINT chapters_snap_status_check
    CHECK (snap_status IN ('legacy', 'ok', 'warn', 'review', 'drop')),
  ADD CONSTRAINT chapters_snapshot_anchor_consistency
    CHECK (
      (
        snapshot_id IS NULL
        AND snippet_index IS NULL
        AND ai_start_sec IS NULL
        AND snap_delta_sec IS NULL
        AND snap_status = 'legacy'
      )
      OR
      (
        snapshot_id IS NOT NULL
        AND snippet_index IS NOT NULL
        AND ai_start_sec IS NOT NULL
        AND snap_delta_sec IS NOT NULL
        AND snap_status IN ('ok', 'warn', 'review', 'drop')
      )
    );

CREATE INDEX idx_chapters_snapshot_id
  ON public.chapters (snapshot_id);

CREATE INDEX idx_chapters_snap_status
  ON public.chapters (snap_status)
  WHERE snap_status <> 'legacy';

CREATE OR REPLACE FUNCTION public.derive_snap_status(p_snap_delta_sec INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_snap_delta_sec <= 10 THEN 'ok'
    WHEN p_snap_delta_sec <= 30 THEN 'warn'
    WHEN p_snap_delta_sec <= 120 THEN 'review'
    ELSE 'drop'
  END
$$;

CREATE OR REPLACE FUNCTION public.transcript_snapshot_start_sec(
  p_snapshot_id   UUID,
  p_snippet_index INTEGER
)
RETURNS INTEGER
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT FLOOR((ts.snippets -> p_snippet_index ->> 'start')::NUMERIC)::INTEGER
  FROM public.transcript_snapshots ts
  WHERE ts.id = p_snapshot_id
    AND p_snippet_index >= 0
    AND p_snippet_index < ts.snippet_count
$$;

CREATE OR REPLACE FUNCTION public.validate_chapter_snapshot_anchor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_snapshot_stream_id UUID;
  v_snippet_count      INTEGER;
  v_expected_start_sec INTEGER;
  v_expected_delta     INTEGER;
BEGIN
  IF NEW.snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ts.stream_id, ts.snippet_count
    INTO v_snapshot_stream_id, v_snippet_count
  FROM public.transcript_snapshots ts
  WHERE ts.id = NEW.snapshot_id;

  IF v_snapshot_stream_id IS NULL THEN
    RAISE EXCEPTION 'transcript_snapshot not found: snapshot_id=%', NEW.snapshot_id;
  END IF;

  IF v_snapshot_stream_id <> NEW.stream_id THEN
    RAISE EXCEPTION
      'snapshot/stream mismatch: chapter.stream_id=%, snapshot.stream_id=%',
      NEW.stream_id,
      v_snapshot_stream_id;
  END IF;

  IF NEW.snippet_index < 0 OR NEW.snippet_index >= v_snippet_count THEN
    RAISE EXCEPTION
      'chapters.snippet_index out of range: snapshot_id=%, snippet_index=%, snippet_count=%',
      NEW.snapshot_id,
      NEW.snippet_index,
      v_snippet_count;
  END IF;

  SELECT public.transcript_snapshot_start_sec(NEW.snapshot_id, NEW.snippet_index)
    INTO v_expected_start_sec;

  IF v_expected_start_sec IS NULL THEN
    RAISE EXCEPTION
      'failed to derive start_sec: snapshot_id=%, snippet_index=%',
      NEW.snapshot_id,
      NEW.snippet_index;
  END IF;

  IF NEW.start_sec <> v_expected_start_sec THEN
    RAISE EXCEPTION
      'start_sec mismatch: expected=%, actual=%, snapshot_id=%, snippet_index=%',
      v_expected_start_sec,
      NEW.start_sec,
      NEW.snapshot_id,
      NEW.snippet_index;
  END IF;

  v_expected_delta := ABS(NEW.ai_start_sec - v_expected_start_sec);

  IF NEW.snap_delta_sec <> v_expected_delta THEN
    RAISE EXCEPTION
      'snap_delta_sec mismatch: expected=%, actual=%, snapshot_id=%, snippet_index=%',
      v_expected_delta,
      NEW.snap_delta_sec,
      NEW.snapshot_id,
      NEW.snippet_index;
  END IF;

  IF NEW.snap_status <> public.derive_snap_status(v_expected_delta) THEN
    RAISE EXCEPTION
      'snap_status mismatch: expected=%, actual=%, delta=%',
      public.derive_snap_status(v_expected_delta),
      NEW.snap_status,
      v_expected_delta;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER chapters_validate_snapshot_anchor
  BEFORE INSERT OR UPDATE OF stream_id, snapshot_id, snippet_index, ai_start_sec, start_sec, snap_delta_sec, snap_status
  ON public.chapters
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_chapter_snapshot_anchor();

CREATE OR REPLACE FUNCTION public.nearest_snippet_index(
  p_snippets   JSONB,
  p_target_sec NUMERIC
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT elem.ordinality::INTEGER - 1
  FROM jsonb_array_elements(p_snippets) WITH ORDINALITY AS elem(value, ordinality)
  ORDER BY
    ABS(COALESCE((elem.value ->> 'start')::NUMERIC, 0) - p_target_sec),
    elem.ordinality
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.transcript_snapshot_nearest_snippet_index(
  p_snapshot_id UUID,
  p_target_sec  NUMERIC
)
RETURNS INTEGER
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT public.nearest_snippet_index(ts.snippets, p_target_sec)
  FROM public.transcript_snapshots ts
  WHERE ts.id = p_snapshot_id
$$;
