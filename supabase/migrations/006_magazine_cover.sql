-- Phase 6: Add cover image fields to magazines table
ALTER TABLE magazines
  ADD COLUMN IF NOT EXISTS cover_image_url      TEXT,
  ADD COLUMN IF NOT EXISTS cover_prompt         TEXT,
  ADD COLUMN IF NOT EXISTS cover_generated_at   TIMESTAMPTZ;
