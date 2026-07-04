GRANT INSERT ON search_logs TO anon, authenticated;

DROP POLICY IF EXISTS "search_logs_public_insert" ON search_logs;

CREATE POLICY "search_logs_public_insert" ON search_logs
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    btrim(query) <> ''
    AND result_count >= 0
    AND (
      user_id IS NULL
      OR user_id = (SELECT auth.uid())
    )
  );
