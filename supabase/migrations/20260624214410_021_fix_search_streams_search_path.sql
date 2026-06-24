ALTER FUNCTION public.search_streams(
  text,
  date,
  date,
  text[],
  text[],
  text[],
  text,
  integer,
  integer,
  uuid
)
SET search_path = public;

NOTIFY pgrst, 'reload schema';
