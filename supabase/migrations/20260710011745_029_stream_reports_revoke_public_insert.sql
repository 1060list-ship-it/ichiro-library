DROP POLICY IF EXISTS "anon_can_insert_reports" ON stream_reports;
REVOKE ALL ON stream_reports FROM anon, authenticated;

COMMENT ON TABLE stream_reports IS
  '書き込みはservice_role(server action)経由のみ。anon/authenticatedへのポリシー・GRANTを意図的に付与しない。';

NOTIFY pgrst, 'reload schema';
