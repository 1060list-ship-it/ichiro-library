-- Phase 8: Entity relation tables for streams and weekly magazines

CREATE TABLE stream_entities (
  stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (stream_id, entity_id)
);

CREATE TABLE magazine_entities (
  magazine_id UUID REFERENCES magazines(id) ON DELETE CASCADE,
  entity_id   UUID REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (magazine_id, entity_id)
);

CREATE INDEX idx_stream_entities_entity ON stream_entities(entity_id);
CREATE INDEX idx_magazine_entities_entity ON magazine_entities(entity_id);

ALTER TABLE stream_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE magazine_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stream_entities_anon_read" ON stream_entities
  FOR SELECT TO anon USING (true);

CREATE POLICY "stream_entities_service_all" ON stream_entities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "magazine_entities_anon_read" ON magazine_entities
  FOR SELECT TO anon USING (true);

CREATE POLICY "magazine_entities_service_all" ON magazine_entities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
