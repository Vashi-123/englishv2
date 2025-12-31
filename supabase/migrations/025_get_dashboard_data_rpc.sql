-- RPC: get_dashboard_data(user_id UUID, level TEXT, lang TEXT)
-- Returns all initial dashboard data in one call:
-- - available_levels
-- - course_modules
-- - day_plans
-- - free_plan
-- - entitlements
-- - grammar_cards (extracted from lesson scripts)

CREATE OR REPLACE FUNCTION public.get_dashboard_data(
  p_user_id UUID,
  p_level TEXT DEFAULT 'A1',
  p_lang TEXT DEFAULT 'ru'
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_levels TEXT[];
  v_modules JSON;
  v_plans JSON;
  v_free_plan JSON;
  v_entitlements JSON;
  v_grammar_cards JSON;
BEGIN
  -- 1. Available levels
  SELECT ARRAY_AGG(DISTINCT ls.level ORDER BY ls.level)
  INTO v_levels
  FROM lesson_scripts ls
  WHERE ls.level IS NOT NULL AND ls.level <> '';

  -- 2. Course modules
  SELECT COALESCE(json_agg(
    json_build_object(
      'id', id,
      'level', level,
      'lang', lang,
      'stageOrder', stage_order,
      'stageTitle', stage_title,
      'moduleOrder', module_order,
      'moduleTitle', module_title,
      'lessonFrom', lesson_from,
      'lessonTo', lesson_to,
      'goal', goal,
      'statusBefore', status_before,
      'statusAfter', status_after,
      'summary', summary
    ) ORDER BY stage_order, module_order
  ), '[]'::json)
  INTO v_modules
  FROM course_modules
  WHERE level = p_level AND lang = p_lang;

  -- 3. Day plans (lesson_scripts)
  SELECT COALESCE(json_agg(
    json_build_object(
      'day', day,
      'lesson', lesson,
      'lessonId', lesson_id,
      'title', 'Lesson #' || lesson,
      'theme', COALESCE(theme, 'Lesson #' || lesson),
      'isLocked', false,
      'isCompleted', false,
      'grammarFocus', '',
      'wordIds', ARRAY[]::TEXT[],
      'level', level
    ) ORDER BY day, lesson
  ), '[]'::json)
  INTO v_plans
  FROM lesson_scripts
  WHERE level = p_level;

  -- 4. Free plan (billing_products)
  SELECT json_build_object(
    'key', key,
    'active', active,
    'lessonAccessLimit', COALESCE(lesson_access_limit, 3)
  )
  INTO v_free_plan
  FROM billing_products
  WHERE key = 'free_default'
  LIMIT 1;

  -- 5. User entitlements (only if user_id provided)
  IF p_user_id IS NOT NULL THEN
    SELECT json_build_object(
      'userId', user_id,
      'isPremium', is_premium,
      'premiumUntil', premium_until
    )
    INTO v_entitlements
    FROM user_entitlements
    WHERE user_id = p_user_id
    LIMIT 1;
  END IF;

  -- 6. Grammar cards (extract from lesson scripts)
  SELECT COALESCE(json_agg(
    json_build_object(
      'day', day,
      'lesson', lesson,
      'theme', COALESCE(theme, 'Lesson #' || lesson),
      'grammar', CASE
        WHEN script->'grammar'->>'explanation' IS NOT NULL THEN
          -- Remove assignment part (everything starting with <h>Задание<h>)
          TRIM(REGEXP_REPLACE(
            script->'grammar'->>'explanation',
            '<h>Задание<h>.*$',
            '',
            'g'
          ))
        ELSE NULL
      END
    ) ORDER BY day, lesson
  ) FILTER (WHERE script->'grammar'->>'explanation' IS NOT NULL), '[]'::json)
  INTO v_grammar_cards
  FROM lesson_scripts
  WHERE level = p_level
    AND script IS NOT NULL
    AND script->'grammar'->>'explanation' IS NOT NULL;

  -- Build result JSON
  v_result := json_build_object(
    'availableLevels', COALESCE(v_levels, ARRAY[]::TEXT[]),
    'courseModules', COALESCE(v_modules, '[]'::json),
    'dayPlans', COALESCE(v_plans, '[]'::json),
    'freePlan', COALESCE(v_free_plan, json_build_object('key', 'free_default', 'active', true, 'lessonAccessLimit', 3)),
    'entitlements', v_entitlements,
    'grammarCards', COALESCE(v_grammar_cards, '[]'::json)
  );

  RETURN v_result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_dashboard_data(UUID, TEXT, TEXT) TO anon, authenticated;

-- Add comment
COMMENT ON FUNCTION public.get_dashboard_data(UUID, TEXT, TEXT) IS 
'Returns all initial dashboard data in one call: levels, modules, plans, free plan, entitlements, and grammar cards';

