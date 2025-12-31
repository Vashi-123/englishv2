-- RPC: get_lesson_init_data(user_id UUID, day INT, lesson INT, level TEXT, include_script BOOLEAN, include_messages BOOLEAN)
-- Returns all initial lesson data in one call:
-- - lesson_id
-- - script (optional)
-- - progress (lesson_progress)
-- - messages (chat_messages, optional)

CREATE OR REPLACE FUNCTION public.get_lesson_init_data(
  p_user_id UUID,
  p_day INT,
  p_lesson INT,
  p_level TEXT DEFAULT 'A1',
  p_include_script BOOLEAN DEFAULT TRUE,
  p_include_messages BOOLEAN DEFAULT TRUE
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_lesson_id UUID;
  v_script JSONB;
  v_progress JSON;
  v_messages JSON;
BEGIN
  -- 1. Get lesson_id and optionally script from lesson_scripts
  SELECT lesson_id, 
         CASE WHEN p_include_script THEN script ELSE NULL END
  INTO v_lesson_id, v_script
  FROM lesson_scripts
  WHERE day = p_day 
    AND lesson = p_lesson
    AND level = p_level
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Fallback: if no level match, try without level filter
  IF v_lesson_id IS NULL THEN
    SELECT lesson_id,
           CASE WHEN p_include_script THEN script ELSE NULL END
    INTO v_lesson_id, v_script
    FROM lesson_scripts
    WHERE day = p_day 
      AND lesson = p_lesson
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;

  -- 2. Get progress (only if user_id provided and lesson_id found)
  IF p_user_id IS NOT NULL AND v_lesson_id IS NOT NULL THEN
    SELECT json_build_object(
      'currentStepSnapshot', current_step_snapshot,
      'completed', completed_at IS NOT NULL
    )
    INTO v_progress
    FROM lesson_progress
    WHERE user_id = p_user_id
      AND lesson_id = v_lesson_id
    LIMIT 1;
  END IF;

  -- 3. Get messages (only if user_id provided, lesson_id found, and include_messages is true)
  IF p_user_id IS NOT NULL AND v_lesson_id IS NOT NULL AND p_include_messages THEN
    SELECT COALESCE(json_agg(
      json_build_object(
        'id', id,
        'role', role,
        'text', text,
        'createdAt', created_at,
        'messageOrder', message_order,
        'currentStepSnapshot', current_step_snapshot
      ) ORDER BY created_at ASC, id ASC
    ), '[]'::json)
    INTO v_messages
    FROM chat_messages
    WHERE user_id = p_user_id
      AND lesson_id = v_lesson_id;
  END IF;

  -- Build result JSON
  v_result := json_build_object(
    'lessonId', v_lesson_id,
    'script', CASE WHEN p_include_script THEN v_script ELSE NULL END,
    'progress', v_progress,
    'messages', COALESCE(v_messages, '[]'::json)
  );

  RETURN v_result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_lesson_init_data(UUID, INT, INT, TEXT, BOOLEAN, BOOLEAN) TO anon, authenticated;

-- Add comment
COMMENT ON FUNCTION public.get_lesson_init_data(UUID, INT, INT, TEXT, BOOLEAN, BOOLEAN) IS 
'Returns all initial lesson data in one call: lesson_id, script (optional), progress, and messages (optional)';

