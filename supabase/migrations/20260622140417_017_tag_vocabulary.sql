CREATE TABLE public.tag_vocabulary (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE
              CHECK (slug = lower(btrim(slug)) AND slug ~ '^[a-z0-9_]+$'),
  label       TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tag_vocabulary IS
  'AI が選択できるタグの統制語彙。streams.tags は slug を保存する。';

COMMENT ON COLUMN public.tag_vocabulary.slug IS
  'AI へ渡す識別子。例: music_talk, late_night。';

CREATE INDEX idx_tag_vocabulary_active_sort
  ON public.tag_vocabulary (is_active, sort_order, category);

CREATE INDEX idx_tag_vocabulary_category_active
  ON public.tag_vocabulary (category, sort_order)
  WHERE is_active = true;

CREATE TRIGGER tag_vocabulary_updated_at
  BEFORE UPDATE
  ON public.tag_vocabulary
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.tag_vocabulary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tag_vocabulary_anon_read"
  ON public.tag_vocabulary
  FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "tag_vocabulary_authenticated_read"
  ON public.tag_vocabulary
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "tag_vocabulary_service_all"
  ON public.tag_vocabulary
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.tag_vocabulary TO anon, authenticated;
