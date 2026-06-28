REVOKE EXECUTE ON FUNCTION public.reorder_playlist_stream(uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reorder_playlist_stream(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_playlist_stream(uuid, uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
