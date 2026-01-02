-- Dashboard snapshots (static + per-user) for ultra-fast cold start.
-- Goal: avoid heavy RPC composition at login; read precomputed JSON from 1 row (+ keep versions).

-- =========================
-- 1) Static snapshot (same for all users)
-- =========================

CREATE TABLE IF NOT EXISTS public.dashboard_static_snapshot (
  level TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ru',
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (level, lang)
);

ALTER TABLE public.dashboard_static_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read dashboard static snapshot" ON public.dashboard_static_snapshot;
CREATE POLICY "Read dashboard static snapshot"
  ON public.dashboard_static_snapshot FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Write dashboard static snapshot (blocked)" ON public.dashboard_static_snapshot;
CREATE POLICY "Write dashboard static snapshot (blocked)"
  ON public.dashboard_static_snapshot FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.build_dashboard_static_snapshot(
  p_level TEXT DEFAULT 'A1',
  p_lang TEXT DEFAULT 'ru'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_levels TEXT[];
  v_modules JSONB;
  v_plans JSONB;
  v_free_plan JSONB;
  v_grammar_cards JSONB;
BEGIN
  -- Available levels
  SELECT ARRAY_AGG(DISTINCT ls.level ORDER BY ls.level)
  INTO v_levels
  FROM lesson_scripts ls
  WHERE ls.level IS NOT NULL AND ls.level <> '';

  -- Course modules (table may not exist in some DBs)
  IF to_regclass('public.course_modules') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
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
    ), '[]'::jsonb)
    INTO v_modules
    FROM course_modules
    WHERE level = p_level AND lang = p_lang;
  ELSE
    v_modules := '[]'::jsonb;
  END IF;

  -- Day plans (lesson_scripts)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
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
  ), '[]'::jsonb)
  INTO v_plans
  FROM lesson_scripts
  WHERE level = p_level;

  -- Free plan
  SELECT jsonb_build_object(
    'key', key,
    'active', active,
    'lessonAccessLimit', COALESCE(lesson_access_limit, 3)
  )
  INTO v_free_plan
  FROM billing_products
  WHERE key = 'free_default'
  LIMIT 1;

  -- Grammar cards (extract from lesson scripts)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', day,
      'lesson', lesson,
      'theme', COALESCE(theme, 'Lesson #' || lesson),
      'grammar', CASE
        WHEN script->'grammar'->>'explanation' IS NOT NULL THEN
          TRIM(REGEXP_REPLACE(
            script->'grammar'->>'explanation',
            '<h>Задание<h>.*$',
            '',
            'g'
          ))
        ELSE NULL
      END
    ) ORDER BY day, lesson
  ) FILTER (WHERE script->'grammar'->>'explanation' IS NOT NULL), '[]'::jsonb)
  INTO v_grammar_cards
  FROM lesson_scripts
  WHERE level = p_level
    AND script IS NOT NULL
    AND script->'grammar'->>'explanation' IS NOT NULL;

  RETURN jsonb_build_object(
    'availableLevels', COALESCE(v_levels, ARRAY[]::TEXT[]),
    'courseModules', COALESCE(v_modules, '[]'::jsonb),
    'dayPlans', COALESCE(v_plans, '[]'::jsonb),
    'freePlan', COALESCE(v_free_plan, jsonb_build_object('key', 'free_default', 'active', true, 'lessonAccessLimit', 3)),
    'grammarCards', COALESCE(v_grammar_cards, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_dashboard_static_snapshot(
  p_level TEXT DEFAULT 'A1',
  p_lang TEXT DEFAULT 'ru'
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data JSONB;
BEGIN
  v_data := public.build_dashboard_static_snapshot(p_level, p_lang);

  INSERT INTO public.dashboard_static_snapshot(level, lang, data)
  VALUES (p_level, p_lang, v_data)
  ON CONFLICT (level, lang) DO UPDATE
  SET
    data = EXCLUDED.data,
    version = public.dashboard_static_snapshot.version + 1,
    updated_at = now();
END;
$$;

-- =========================
-- 2) Per-user snapshot (fast login / dashboard render)
-- =========================

CREATE TABLE IF NOT EXISTS public.user_dashboard_snapshot (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'A1',
  lang TEXT NOT NULL DEFAULT 'ru',
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, level, lang)
);

CREATE INDEX IF NOT EXISTS idx_user_dashboard_snapshot_user_updated
  ON public.user_dashboard_snapshot(user_id, updated_at DESC);

ALTER TABLE public.user_dashboard_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own dashboard snapshot" ON public.user_dashboard_snapshot;
CREATE POLICY "Read own dashboard snapshot"
  ON public.user_dashboard_snapshot FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Write own dashboard snapshot (blocked)" ON public.user_dashboard_snapshot;
CREATE POLICY "Write own dashboard snapshot (blocked)"
  ON public.user_dashboard_snapshot FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.build_user_dashboard_snapshot(
  p_user_id UUID,
  p_level TEXT DEFAULT 'A1',
  p_lang TEXT DEFAULT 'ru'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entitlements JSONB;
  v_day_completed JSONB;
  v_words_count INT;
BEGIN
  -- Entitlements
  SELECT jsonb_build_object(
    'userId', user_id,
    'isPremium', is_premium,
    'premiumUntil', premium_until
  )
  INTO v_entitlements
  FROM user_entitlements
  WHERE user_id = p_user_id
  LIMIT 1;

  -- Per-day completion map for this level (day -> boolean)
  SELECT COALESCE(
    jsonb_object_agg(ls.day::text, (lp.completed_at IS NOT NULL) ORDER BY ls.day),
    '{}'::jsonb
  )
  INTO v_day_completed
  FROM lesson_scripts ls
  LEFT JOIN lesson_progress lp
    ON lp.user_id = p_user_id
    AND lp.lesson_id = ls.lesson_id
  WHERE ls.level = p_level;

  -- Words count for this level + UI lang (target_lang)
  SELECT COALESCE(COUNT(*), 0)::INT
  INTO v_words_count
  FROM user_srs_cards c
  WHERE c.user_id = p_user_id
    AND c.level = p_level
    AND c.source_lang = 'en'
    AND c.target_lang = p_lang;

  RETURN jsonb_build_object(
    'entitlements', v_entitlements,
    'dayCompletedStatus', COALESCE(v_day_completed, '{}'::jsonb),
    'wordsCount', COALESCE(v_words_count, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_user_dashboard_snapshot(
  p_user_id UUID,
  p_level TEXT DEFAULT 'A1',
  p_lang TEXT DEFAULT 'ru'
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data JSONB;
BEGIN
  v_data := public.build_user_dashboard_snapshot(p_user_id, p_level, p_lang);

  INSERT INTO public.user_dashboard_snapshot(user_id, level, lang, data)
  VALUES (p_user_id, p_level, p_lang, v_data)
  ON CONFLICT (user_id, level, lang) DO UPDATE
  SET
    data = EXCLUDED.data,
    version = public.user_dashboard_snapshot.version + 1,
    updated_at = now();
END;
$$;

-- =========================
-- 3) Fetch helper (single RPC call; reads precomputed rows)
-- =========================

CREATE OR REPLACE FUNCTION public.get_dashboard_snapshot(
  p_user_id UUID DEFAULT NULL,
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
  v_static public.dashboard_static_snapshot%ROWTYPE;
  v_user public.user_dashboard_snapshot%ROWTYPE;
  v_user_data JSONB;
  v_out JSONB;
BEGIN
  -- Ensure static row exists (first call after deploy)
  INSERT INTO public.dashboard_static_snapshot(level, lang, data)
  VALUES (p_level, p_lang, public.build_dashboard_static_snapshot(p_level, p_lang))
  ON CONFLICT (level, lang) DO NOTHING;

  SELECT * INTO v_static
  FROM public.dashboard_static_snapshot
  WHERE level = p_level AND lang = p_lang
  LIMIT 1;

  IF p_user_id IS NULL THEN
    v_user_data := jsonb_build_object(
      'entitlements', NULL,
      'dayCompletedStatus', '{}'::jsonb,
      'wordsCount', 0
    );
    v_out := COALESCE(v_static.data, '{}'::jsonb) || v_user_data;
    v_out := v_out || jsonb_build_object('_snapshot', jsonb_build_object(
      'staticVersion', COALESCE(v_static.version, 0),
      'userVersion', NULL,
      'updatedAt', COALESCE(v_static.updated_at, now())
    ));
    RETURN v_out::json;
  END IF;

  -- Ensure per-user row exists
  INSERT INTO public.user_dashboard_snapshot(user_id, level, lang, data)
  VALUES (p_user_id, p_level, p_lang, public.build_user_dashboard_snapshot(p_user_id, p_level, p_lang))
  ON CONFLICT (user_id, level, lang) DO NOTHING;

  SELECT * INTO v_user
  FROM public.user_dashboard_snapshot
  WHERE user_id = p_user_id AND level = p_level AND lang = p_lang
  LIMIT 1;

  v_out := COALESCE(v_static.data, '{}'::jsonb) || COALESCE(v_user.data, '{}'::jsonb);
  v_out := v_out || jsonb_build_object('_snapshot', jsonb_build_object(
    'staticVersion', COALESCE(v_static.version, 0),
    'userVersion', COALESCE(v_user.version, 0),
    'updatedAt', GREATEST(COALESCE(v_static.updated_at, now()), COALESCE(v_user.updated_at, now()))
  ));

  RETURN v_out::json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_snapshot(UUID, TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.get_dashboard_snapshot(UUID, TEXT, TEXT) IS
'Returns dashboard data from precomputed snapshot rows (static + per-user) and includes _snapshot meta.';

-- =========================
-- 4) Triggers: keep snapshots fresh
-- =========================

CREATE OR REPLACE FUNCTION public._trg_refresh_static_from_lesson_scripts()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level TEXT;
  v_lang TEXT;
  v_refreshed BOOLEAN := false;
BEGIN
  v_level := COALESCE(NEW.level, OLD.level, 'A1');

  -- Refresh all existing langs for this level; if none exist yet, refresh default.
  FOR v_lang IN
    SELECT s.lang FROM public.dashboard_static_snapshot s WHERE s.level = v_level
  LOOP
    PERFORM public.refresh_dashboard_static_snapshot(v_level, v_lang);
    v_refreshed := true;
  END LOOP;

  IF NOT v_refreshed THEN
    PERFORM public.refresh_dashboard_static_snapshot(v_level, 'ru');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.lesson_scripts') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refresh_static_snapshot_from_lesson_scripts') THEN
      CREATE TRIGGER trg_refresh_static_snapshot_from_lesson_scripts
      AFTER INSERT OR UPDATE OR DELETE ON public.lesson_scripts
      FOR EACH ROW
      EXECUTE FUNCTION public._trg_refresh_static_from_lesson_scripts();
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_refresh_static_from_billing_products()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  -- Billing changes affect all static snapshots (free plan limits etc).
  FOR r IN SELECT level, lang FROM public.dashboard_static_snapshot LOOP
    PERFORM public.refresh_dashboard_static_snapshot(r.level, r.lang);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.billing_products') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refresh_static_snapshot_from_billing_products') THEN
      CREATE TRIGGER trg_refresh_static_snapshot_from_billing_products
      AFTER INSERT OR UPDATE OR DELETE ON public.billing_products
      FOR EACH ROW
      EXECUTE FUNCTION public._trg_refresh_static_from_billing_products();
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_refresh_static_from_course_modules()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level TEXT;
  v_lang TEXT;
BEGIN
  v_level := COALESCE(NEW.level, OLD.level, 'A1');
  v_lang := COALESCE(NEW.lang, OLD.lang, 'ru');
  PERFORM public.refresh_dashboard_static_snapshot(v_level, v_lang);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.course_modules') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refresh_static_snapshot_from_course_modules') THEN
      CREATE TRIGGER trg_refresh_static_snapshot_from_course_modules
      AFTER INSERT OR UPDATE OR DELETE ON public.course_modules
      FOR EACH ROW
      EXECUTE FUNCTION public._trg_refresh_static_from_course_modules();
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_refresh_user_from_lesson_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_level TEXT;
  v_lang TEXT;
  v_refreshed BOOLEAN := false;
BEGIN
  v_user_id := COALESCE(NEW.user_id, OLD.user_id);
  v_level := COALESCE(NEW.level, OLD.level, 'A1');
  IF v_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Refresh all existing langs for this user+level; if none exist yet, refresh default.
  FOR v_lang IN
    SELECT s.lang FROM public.user_dashboard_snapshot s WHERE s.user_id = v_user_id AND s.level = v_level
  LOOP
    PERFORM public.refresh_user_dashboard_snapshot(v_user_id, v_level, v_lang);
    v_refreshed := true;
  END LOOP;

  IF NOT v_refreshed THEN
    PERFORM public.refresh_user_dashboard_snapshot(v_user_id, v_level, 'ru');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.lesson_progress') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refresh_user_snapshot_from_lesson_progress') THEN
      CREATE TRIGGER trg_refresh_user_snapshot_from_lesson_progress
      AFTER INSERT OR UPDATE OR DELETE ON public.lesson_progress
      FOR EACH ROW
      EXECUTE FUNCTION public._trg_refresh_user_from_lesson_progress();
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_refresh_user_from_user_srs_cards()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_level TEXT;
  v_lang TEXT;
BEGIN
  v_user_id := COALESCE(NEW.user_id, OLD.user_id);
  v_level := COALESCE(NEW.level, OLD.level, 'A1');
  v_lang := COALESCE(NEW.target_lang, OLD.target_lang, 'ru');
  IF v_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM public.refresh_user_dashboard_snapshot(v_user_id, v_level, v_lang);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.user_srs_cards') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refresh_user_snapshot_from_user_srs_cards') THEN
      CREATE TRIGGER trg_refresh_user_snapshot_from_user_srs_cards
      AFTER INSERT OR UPDATE OR DELETE ON public.user_srs_cards
      FOR EACH ROW
      EXECUTE FUNCTION public._trg_refresh_user_from_user_srs_cards();
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_refresh_user_from_user_entitlements()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  r RECORD;
  v_refreshed BOOLEAN := false;
BEGIN
  v_user_id := COALESCE(NEW.user_id, OLD.user_id);
  IF v_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOR r IN
    SELECT level, lang FROM public.user_dashboard_snapshot s WHERE s.user_id = v_user_id
  LOOP
    PERFORM public.refresh_user_dashboard_snapshot(v_user_id, r.level, r.lang);
    v_refreshed := true;
  END LOOP;

  IF NOT v_refreshed THEN
    PERFORM public.refresh_user_dashboard_snapshot(v_user_id, 'A1', 'ru');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.user_entitlements') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refresh_user_snapshot_from_user_entitlements') THEN
      CREATE TRIGGER trg_refresh_user_snapshot_from_user_entitlements
      AFTER INSERT OR UPDATE OR DELETE ON public.user_entitlements
      FOR EACH ROW
      EXECUTE FUNCTION public._trg_refresh_user_from_user_entitlements();
    END IF;
  END IF;
END;
$$;

