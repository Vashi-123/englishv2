-- RPC: get_available_levels()
-- Returns distinct levels available in lesson_scripts, sorted.

CREATE OR REPLACE FUNCTION public.get_available_levels()
RETURNS TABLE(level text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ls.level
  FROM public.lesson_scripts ls
  WHERE ls.level IS NOT NULL AND ls.level <> ''
  ORDER BY ls.level ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_levels() TO anon, authenticated;

