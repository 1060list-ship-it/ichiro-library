alter function public.update_updated_at() set search_path = public, pg_temp;
alter function public.sync_stream_rating() set search_path = public, pg_temp;
alter function public.sync_transcript_snapshot_derived_fields() set search_path = public, pg_temp;
alter function public.derive_snap_status(integer) set search_path = public, pg_temp;
alter function public.transcript_snapshot_start_sec(uuid, integer) set search_path = public, pg_temp;
alter function public.validate_chapter_snapshot_anchor() set search_path = public, pg_temp;
alter function public.nearest_snippet_index(jsonb, numeric) set search_path = public, pg_temp;
alter function public.transcript_snapshot_nearest_snippet_index(uuid, numeric) set search_path = public, pg_temp;
