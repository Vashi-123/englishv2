-- RPC: get_lesson_distribution(days_back INT DEFAULT 90)
-- Returns user count per lesson: total (all time) and valid for the specific period.

-- Drop the function first because we are changing the return type signature
DROP FUNCTION IF EXISTS public.get_lesson_distribution(INT);

CREATE OR REPLACE FUNCTION public.get_lesson_distribution(
  days_back INT DEFAULT 90
)
RETURNS TABLE (
  lesson_id UUID,
  day INT,
  lesson INT,
  title TEXT,
  total_users BIGINT,
  period_users BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ls.lesson_id,
    ls.day,
    ls.lesson,
    ('Lesson ' || ls.lesson) AS title,
    -- Total users ever (all time)
    COUNT(DISTINCT lp.user_id) AS total_users,
    -- Users active in the selected period
    COUNT(DISTINCT CASE WHEN lp.updated_at >= CURRENT_DATE - (days_back || ' days')::INTERVAL THEN lp.user_id END) AS period_users
  FROM lesson_scripts ls
  JOIN lesson_progress lp ON lp.lesson_id = ls.lesson_id
  -- Removed the WHERE clause that filtered the whole rows by date. 
  -- Now we include all lessons that have EVER had progress.
  GROUP BY ls.lesson_id, ls.day, ls.lesson
  ORDER BY ls.day ASC, ls.lesson ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lesson_distribution(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_lesson_distribution(INT) TO authenticated;

COMMENT ON FUNCTION public.get_lesson_distribution(INT) IS 
'Returns distribution of users across lessons. total_users = all time, period_users = active in last N days.';
