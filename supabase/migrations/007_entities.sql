-- Phase 7: Entities table for knowledge base (people, collaborators, products, etc.)
-- Data source: docs/ichiro-reference.md
-- Populated via: packages/pipeline/seed_entities.py

CREATE TABLE entities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,          -- URL-safe identifier e.g. 'hanaregumi'
  name         TEXT NOT NULL,                 -- Display name e.g. 'ハナレグミ（永積 崇）'
  match_names  TEXT[] NOT NULL DEFAULT '{}',  -- All aliases for auto-linking (longest-match priority)
  category     TEXT NOT NULL,                 -- family | celebrity | remixer | team | craftsman | product
  role         TEXT,                           -- e.g. 'シンガーソングライター'
  description  TEXT NOT NULL DEFAULT '',      -- Relationship/background from reference.md
  related_work TEXT,                          -- Category-specific: tracks remixed, product specs, etc.
  external_url TEXT,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_entities_category    ON entities(category);
CREATE INDEX idx_entities_sort        ON entities(sort_order ASC);
CREATE INDEX idx_entities_match_names ON entities USING gin(match_names);

-- Auto-update updated_at
CREATE TRIGGER entities_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();  -- reuse function from 001_initial_schema.sql

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entities_anon_read" ON entities
  FOR SELECT TO anon USING (true);

CREATE POLICY "entities_service_all" ON entities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
