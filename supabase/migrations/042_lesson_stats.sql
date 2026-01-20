-- RPC: get_lesson_distribution(days_back INT DEFAULT 30)
-- Returns user count per lesson.
-- Useful for "Lesson Progress" chart in Admin Dashboard.

CREATE OR REPLACE FUNCTION public.get_lesson_distribution(
  days_back INT DEFAULT 90
)
RETURNS TABLE (
  lesson_id UUID,
  day INT,
  lesson INT,
  title TEXT,
  user_count BIGINT
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
    -- Construct a readable title "Day X / Lesson Y" or just use script title extracted if possible
    -- For now, let's just return Day/Lesson numbers and frontend can format it.
    -- Or we can try to extract a short title from script text if needed, but that's expensive/messy.
    -- Let's stick to Day/Lesson #.
    ('Day ' || ls.day || ', Lesson ' || ls.lesson) AS title,
    COUNT(DISTINCT lp.user_id) AS user_count
  FROM lesson_scripts ls
  JOIN lesson_progress lp ON lp.lesson_id = ls.lesson_id
  WHERE 
    -- Only count activity within the last X days? 
    -- Actually, user probably wants CURRENT distribution of active users.
    -- Or ALL time distribution?
    -- Usually "Lesson Progress" means "Where are users currently stopped at?".
    -- But since users can complete multiple lessons, this query counts how many users HAVE COMPLETED or STARTED a lesson.
    -- If we want "Current Lesson", we should pick the MAX(lesson) per user.
    -- "Users at each lesson" usually means "Users whose highest unlocked lesson is X".
    -- HOWEVER, lesson_progress stores all lessons.
    -- Let's switch to "Highest Lesson Reached" logic for better funnel visualization.
    
    -- Subquery to get max lesson for each user?
    -- No, simpler: Group by lesson and count users who have this lesson in their progress.
    -- This shows "How many people reached Lesson X".
    -- This is a funnel view. Lesson 1 should have max users, Lesson 10 fewer.
    
    lp.updated_at >= CURRENT_DATE - (days_back || ' days')::INTERVAL
  GROUP BY ls.lesson_id, ls.day, ls.lesson
  ORDER BY ls.day ASC, ls.lesson ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lesson_distribution(INT) TO service_role;
-- Also grant to authenticated users if admins query it directly from client
GRANT EXECUTE ON FUNCTION public.get_lesson_distribution(INT) TO authenticated;

COMMENT ON FUNCTION public.get_lesson_distribution(INT) IS 
'Returns distribution of users across lessons (funnel view) based on activity in the last N days.';
