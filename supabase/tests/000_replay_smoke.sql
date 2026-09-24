-- Clean replay smoke tests (pgTAP)
-- 目的: 全migrationのクリーン再生後に、主要RPCが実際に動くことと、
--       過去インシデントの修正（RLS/GRANT/CHECK制約）が再現していることを検証する。
begin;

select plan(6);

select lives_ok(
  $$select count(*) from public.get_engagement_ranking(5, null::date, null::date)$$,
  'get_engagement_ranking executes (positional record cast regression, 020)'
);
select lives_ok(
  $$select count(*) from public.search_streams('音楽')$$,
  'search_streams executes (014_member_auth signature)'
);

select ok(
  not has_table_privilege('anon', 'public.stream_reports', 'INSERT'),
  'anon cannot INSERT stream_reports (029 revoke)'
);
select ok(
  not has_column_privilege('anon', 'public.streams', 'transcript', 'SELECT'),
  'anon cannot SELECT streams.transcript (014a/026 revoke)'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'pipeline_jobs_kind_check'
      and pg_get_constraintdef(oid) like '%whisper_transcribe%'
  ),
  'pipeline_jobs kind CHECK accepts whisper_transcribe (20260908063934)'
);
select ok(
  exists (select 1 from supabase_migrations.schema_migrations),
  'migration history recorded'
);

select * from finish();
rollback;
