CREATE TABLE public.transcript_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id     UUID NOT NULL
                REFERENCES public.streams(id) ON DELETE CASCADE,
  source        TEXT NOT NULL
                CHECK (source IN ('youtube_api', 'supadata', 'whisper')),
  lang          TEXT NOT NULL DEFAULT 'ja'
                CHECK (lang = btrim(lang) AND lang <> ''),
  snippets      JSONB NOT NULL,
  snippet_count INTEGER NOT NULL DEFAULT 0
                CHECK (snippet_count >= 0),
  total_sec     NUMERIC(10,3),
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transcript_snapshots_snippets_is_array
    CHECK (jsonb_typeof(snippets) = 'array')
);

COMMENT ON TABLE public.transcript_snapshots IS
  '字幕スナップショット履歴。chapters/highlights の秒数導出元。生字幕なので anon/authenticated 非公開。';

COMMENT ON COLUMN public.transcript_snapshots.source IS
  '字幕取得元。youtube_api / supadata / whisper。';

COMMENT ON COLUMN public.transcript_snapshots.snippets IS
  '[{text, start, duration}] の JSONB 配列。0-based 添字を chapters.snippet_index に保存する。';

COMMENT ON COLUMN public.transcript_snapshots.snippet_count IS
  'snippets 配列長のキャッシュ。trigger で同期する。';

COMMENT ON COLUMN public.transcript_snapshots.total_sec IS
  '最終 snippet の start + duration。trigger で同期する。';

CREATE INDEX idx_transcript_snapshots_stream_captured_at
  ON public.transcript_snapshots (stream_id, captured_at DESC, id DESC);

CREATE INDEX idx_transcript_snapshots_source_lang
  ON public.transcript_snapshots (source, lang);

CREATE OR REPLACE FUNCTION public.sync_transcript_snapshot_derived_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_last JSONB;
BEGIN
  IF jsonb_typeof(NEW.snippets) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'transcript_snapshots.snippets must be a JSON array';
  END IF;

  NEW.snippet_count := jsonb_array_length(NEW.snippets);

  IF NEW.snippet_count = 0 THEN
    NEW.total_sec := NULL;
  ELSE
    v_last := NEW.snippets -> (NEW.snippet_count - 1);
    NEW.total_sec :=
      COALESCE((v_last ->> 'start')::NUMERIC, 0)
      + COALESCE((v_last ->> 'duration')::NUMERIC, 0);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transcript_snapshots_sync_derived_fields
  BEFORE INSERT OR UPDATE OF snippets
  ON public.transcript_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_transcript_snapshot_derived_fields();

CREATE TRIGGER transcript_snapshots_updated_at
  BEFORE UPDATE
  ON public.transcript_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.transcript_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transcript_snapshots_service_all"
  ON public.transcript_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.transcript_snapshots FROM PUBLIC;
REVOKE ALL ON public.transcript_snapshots FROM anon, authenticated;
