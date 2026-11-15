-- Run after all migrations and seed on an isolated test database; all changes roll back.
begin;
select plan(1);
create function pg_temp.check_summary_save() returns boolean language plpgsql as $$
declare
  confirmed public.streams%rowtype;
  fresh uuid := gen_random_uuid();
  unknown_id uuid := gen_random_uuid();
  first_run uuid := gen_random_uuid();
  result jsonb;
  v bigint;
begin
  if (select count(*) from public.streams where video_id in ('test_stream_001','test_stream_002','test_stream_003')
      and summary_success_seen is true and summary_review_base_status = 'legacy_unreviewed'
      and summary_review_status = case when is_reviewed then 'confirmed' else 'legacy_unreviewed' end) <> 3 then
    raise exception 'seed fixture state mismatch';
  end if;
  select * into strict confirmed from public.streams where video_id = 'test_stream_001';
  update public.streams set title = title || ' metadata' where id = confirmed.id;
  if not exists (select 1 from public.streams where id = confirmed.id and is_reviewed
      and summary_review_status = 'confirmed' and summary_review_version = confirmed.summary_review_version
      and summary = confirmed.summary and summary_success_seen is true) then
    raise exception 'confirmed metadata update changed review state';
  end if;
  insert into public.streams(id, video_id, title, stream_date, summary_success_seen)
    values (fresh, fresh::text, 'fresh', date '2026-11-15', false),
           (unknown_id, unknown_id::text, 'unknown', date '2026-11-15', null);
  result := public.save_generated_summary(fresh, 0, 'first summary', first_run);
  if (result->>'was_first_summary_success')::boolean is distinct from true
     or (result->>'review_run_id')::uuid is distinct from first_run
     or (select count(*) from public.summary_review_runs where stream_id = fresh and state = 'pending') <> 1 then
    raise exception 'first success did not create one pending run';
  end if;
  v := (result->>'version')::bigint;
  result := public.save_generated_summary(fresh, v, 'second summary', gen_random_uuid());
  if (result->>'was_first_summary_success')::boolean is distinct from false
     or result->>'review_run_id' is not null
     or (select count(*) from public.summary_review_runs where stream_id = fresh) <> 1
     or not exists (select 1 from public.summary_review_runs where review_run_id = first_run and state = 'stale' and finished_at is not null) then
    raise exception 'resave did not stale the only run';
  end if;
  result := public.save_generated_summary(unknown_id, 0, 'unknown history summary', gen_random_uuid());
  if (result->>'was_first_summary_success')::boolean is distinct from false
     or result->>'review_run_id' is not null
     or exists (select 1 from public.summary_review_runs where stream_id = unknown_id)
     or not exists (select 1 from public.streams where id = unknown_id and summary_success_seen is null
                    and summary = 'unknown history summary' and summary_review_status = 'legacy_unreviewed') then
    raise exception 'unknown history created run or lost history';
  end if;
  return true;
end $$;
select ok(pg_temp.check_summary_save(), 'seed and summary save regression');
select * from finish();
rollback;
