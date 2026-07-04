UPDATE public.tag_vocabulary
SET is_active = false
WHERE slug IN ('casual_talk', 'fan_interaction', 'relationships');

COMMENT ON COLUMN public.tag_vocabulary.slug IS
  'AI へ渡す識別子。例: music_production, ann。';
