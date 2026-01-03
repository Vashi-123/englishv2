-- User review cards for non-vocab exercises (constructor / find_the_mistake).
-- Uses SM-2 style scheduling like user_srs_cards, but stores the exercise payload as JSON.

-- Constructor cards
CREATE TABLE IF NOT EXISTS public.user_constructor_cards (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'A1',
  target_lang TEXT NOT NULL,
  task_key TEXT NOT NULL,
  task JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  seen_count INT NOT NULL DEFAULT 0,
  review_count INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  wrong_count INT NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,

  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INT NOT NULL DEFAULT 0,
  repetitions INT NOT NULL DEFAULT 0,
  last_quality INT NULL,

  last_seen_at TIMESTAMPTZ NULL,
  last_review_at TIMESTAMPTZ NULL,
  next_due_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_constructor_cards_unique
  ON public.user_constructor_cards(user_id, level, target_lang, task_key);

CREATE INDEX IF NOT EXISTS idx_user_constructor_cards_due
  ON public.user_constructor_cards(user_id, level, target_lang, next_due_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_constructor_cards_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_user_constructor_cards_set_updated_at
      BEFORE UPDATE ON public.user_constructor_cards
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$$;

ALTER TABLE public.user_constructor_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read constructor cards" ON public.user_constructor_cards;
DROP POLICY IF EXISTS "Insert constructor cards" ON public.user_constructor_cards;
DROP POLICY IF EXISTS "Update constructor cards" ON public.user_constructor_cards;
DROP POLICY IF EXISTS "Delete constructor cards" ON public.user_constructor_cards;

CREATE POLICY "Read constructor cards"
  ON public.user_constructor_cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Insert constructor cards"
  ON public.user_constructor_cards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update constructor cards"
  ON public.user_constructor_cards FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Delete constructor cards"
  ON public.user_constructor_cards FOR DELETE
  USING (auth.uid() = user_id);

-- RPC: upsert constructor cards from lesson script (increment seen_count on conflict)
CREATE OR REPLACE FUNCTION public.upsert_constructor_cards(
  p_level TEXT,
  p_target_lang TEXT,
  p_items JSONB
)
RETURNS TABLE (
  out_id BIGINT,
  out_task_key TEXT,
  out_task JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  it JSONB;
  v_key TEXT;
  v_task JSONB;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_key := COALESCE(it->>'task_key', '');
    v_task := it->'task';
    IF v_key = '' OR v_task IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.user_constructor_cards(
      user_id, level, target_lang, task_key, task,
      last_seen_at, seen_count
    )
    VALUES (
      auth.uid(), p_level, p_target_lang, v_key, v_task,
      now(), 1
    )
    ON CONFLICT (user_id, level, target_lang, task_key)
    DO UPDATE SET
      task = EXCLUDED.task,
      last_seen_at = now(),
      seen_count = public.user_constructor_cards.seen_count + 1;
  END LOOP;

  RETURN QUERY
  SELECT c.id AS out_id, c.task_key AS out_task_key, c.task AS out_task
  FROM public.user_constructor_cards c
  WHERE c.user_id = auth.uid()
    AND c.level = p_level
    AND c.target_lang = p_target_lang
    AND c.task_key IN (SELECT (x->>'task_key') FROM jsonb_array_elements(p_items) x);
END;
$$;

-- RPC: fetch constructor review batch (due-first, then fill)
CREATE OR REPLACE FUNCTION public.get_constructor_review_batch(
  p_level TEXT,
  p_target_lang TEXT,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  id BIGINT,
  task_key TEXT,
  task JSONB
)
LANGUAGE SQL
STABLE
AS $$
  WITH due AS (
    SELECT c.id, c.task_key, c.task
    FROM public.user_constructor_cards c
    WHERE c.user_id = auth.uid()
      AND c.level = p_level
      AND c.target_lang = p_target_lang
      AND c.next_due_at IS NOT NULL
      AND c.next_due_at <= now()
    ORDER BY c.next_due_at ASC, c.wrong_count DESC, c.review_count ASC
    LIMIT GREATEST(0, p_limit)
  ),
  fill AS (
    SELECT c.id, c.task_key, c.task
    FROM public.user_constructor_cards c
    WHERE c.user_id = auth.uid()
      AND c.level = p_level
      AND c.target_lang = p_target_lang
      AND c.id NOT IN (SELECT id FROM due)
    ORDER BY
      (c.next_due_at IS NULL) DESC,
      c.seen_count ASC,
      COALESCE(c.next_due_at, now()) ASC,
      c.wrong_count DESC
    LIMIT GREATEST(0, p_limit - (SELECT COUNT(*) FROM due))
  )
  SELECT * FROM due
  UNION ALL
  SELECT * FROM fill;
$$;

-- RPC: apply SM-2 review update to a constructor card
CREATE OR REPLACE FUNCTION public.apply_constructor_review(
  p_card_id BIGINT,
  p_quality INT
)
RETURNS TABLE (
  id BIGINT,
  next_due_at TIMESTAMPTZ,
  interval_days INT,
  ease_factor REAL,
  repetitions INT,
  streak INT,
  review_count INT,
  correct_count INT,
  wrong_count INT,
  last_quality INT,
  last_review_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  q INT := GREATEST(0, LEAST(5, p_quality));
  ef REAL;
  reps INT;
  interval INT;
BEGIN
  SELECT c.ease_factor, c.repetitions, c.interval_days
  INTO ef, reps, interval
  FROM public.user_constructor_cards c
  WHERE c.id = p_card_id AND c.user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Constructor card not found';
  END IF;

  ef := ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  IF ef < 1.3 THEN ef := 1.3; END IF;

  IF q < 3 THEN
    reps := 0;
    interval := 1;
  ELSE
    IF reps = 0 THEN
      interval := 1;
    ELSIF reps = 1 THEN
      interval := 6;
    ELSE
      interval := GREATEST(1, ROUND(interval * ef)::INT);
    END IF;
    reps := reps + 1;
  END IF;

  UPDATE public.user_constructor_cards
  SET
    review_count = review_count + 1,
    correct_count = correct_count + CASE WHEN q >= 3 THEN 1 ELSE 0 END,
    wrong_count = wrong_count + CASE WHEN q < 3 THEN 1 ELSE 0 END,
    streak = CASE WHEN q >= 3 THEN streak + 1 ELSE 0 END,
    repetitions = reps,
    interval_days = interval,
    ease_factor = ef,
    last_quality = q,
    last_review_at = now(),
    next_due_at = now() + make_interval(days => interval)
  WHERE id = p_card_id AND user_id = auth.uid();

  RETURN QUERY
  SELECT
    c.id,
    c.next_due_at,
    c.interval_days,
    c.ease_factor,
    c.repetitions,
    c.streak,
    c.review_count,
    c.correct_count,
    c.wrong_count,
    c.last_quality,
    c.last_review_at
  FROM public.user_constructor_cards c
  WHERE c.id = p_card_id AND c.user_id = auth.uid();
END;
$$;

-- Find-the-mistake cards
CREATE TABLE IF NOT EXISTS public.user_find_mistake_cards (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'A1',
  target_lang TEXT NOT NULL,
  task_key TEXT NOT NULL,
  task JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  seen_count INT NOT NULL DEFAULT 0,
  review_count INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  wrong_count INT NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,

  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INT NOT NULL DEFAULT 0,
  repetitions INT NOT NULL DEFAULT 0,
  last_quality INT NULL,

  last_seen_at TIMESTAMPTZ NULL,
  last_review_at TIMESTAMPTZ NULL,
  next_due_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_find_mistake_cards_unique
  ON public.user_find_mistake_cards(user_id, level, target_lang, task_key);

CREATE INDEX IF NOT EXISTS idx_user_find_mistake_cards_due
  ON public.user_find_mistake_cards(user_id, level, target_lang, next_due_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_find_mistake_cards_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_user_find_mistake_cards_set_updated_at
      BEFORE UPDATE ON public.user_find_mistake_cards
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$$;

ALTER TABLE public.user_find_mistake_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read find mistake cards" ON public.user_find_mistake_cards;
DROP POLICY IF EXISTS "Insert find mistake cards" ON public.user_find_mistake_cards;
DROP POLICY IF EXISTS "Update find mistake cards" ON public.user_find_mistake_cards;
DROP POLICY IF EXISTS "Delete find mistake cards" ON public.user_find_mistake_cards;

CREATE POLICY "Read find mistake cards"
  ON public.user_find_mistake_cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Insert find mistake cards"
  ON public.user_find_mistake_cards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update find mistake cards"
  ON public.user_find_mistake_cards FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Delete find mistake cards"
  ON public.user_find_mistake_cards FOR DELETE
  USING (auth.uid() = user_id);

-- RPC: upsert find-the-mistake cards from lesson script (increment seen_count on conflict)
CREATE OR REPLACE FUNCTION public.upsert_find_mistake_cards(
  p_level TEXT,
  p_target_lang TEXT,
  p_items JSONB
)
RETURNS TABLE (
  out_id BIGINT,
  out_task_key TEXT,
  out_task JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  it JSONB;
  v_key TEXT;
  v_task JSONB;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_key := COALESCE(it->>'task_key', '');
    v_task := it->'task';
    IF v_key = '' OR v_task IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.user_find_mistake_cards(
      user_id, level, target_lang, task_key, task,
      last_seen_at, seen_count
    )
    VALUES (
      auth.uid(), p_level, p_target_lang, v_key, v_task,
      now(), 1
    )
    ON CONFLICT (user_id, level, target_lang, task_key)
    DO UPDATE SET
      task = EXCLUDED.task,
      last_seen_at = now(),
      seen_count = public.user_find_mistake_cards.seen_count + 1;
  END LOOP;

  RETURN QUERY
  SELECT c.id AS out_id, c.task_key AS out_task_key, c.task AS out_task
  FROM public.user_find_mistake_cards c
  WHERE c.user_id = auth.uid()
    AND c.level = p_level
    AND c.target_lang = p_target_lang
    AND c.task_key IN (SELECT (x->>'task_key') FROM jsonb_array_elements(p_items) x);
END;
$$;

-- RPC: fetch find-the-mistake review batch
CREATE OR REPLACE FUNCTION public.get_find_mistake_review_batch(
  p_level TEXT,
  p_target_lang TEXT,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  id BIGINT,
  task_key TEXT,
  task JSONB
)
LANGUAGE SQL
STABLE
AS $$
  WITH due AS (
    SELECT c.id, c.task_key, c.task
    FROM public.user_find_mistake_cards c
    WHERE c.user_id = auth.uid()
      AND c.level = p_level
      AND c.target_lang = p_target_lang
      AND c.next_due_at IS NOT NULL
      AND c.next_due_at <= now()
    ORDER BY c.next_due_at ASC, c.wrong_count DESC, c.review_count ASC
    LIMIT GREATEST(0, p_limit)
  ),
  fill AS (
    SELECT c.id, c.task_key, c.task
    FROM public.user_find_mistake_cards c
    WHERE c.user_id = auth.uid()
      AND c.level = p_level
      AND c.target_lang = p_target_lang
      AND c.id NOT IN (SELECT id FROM due)
    ORDER BY
      (c.next_due_at IS NULL) DESC,
      c.seen_count ASC,
      COALESCE(c.next_due_at, now()) ASC,
      c.wrong_count DESC
    LIMIT GREATEST(0, p_limit - (SELECT COUNT(*) FROM due))
  )
  SELECT * FROM due
  UNION ALL
  SELECT * FROM fill;
$$;

-- RPC: apply SM-2 review update to a find-the-mistake card
CREATE OR REPLACE FUNCTION public.apply_find_mistake_review(
  p_card_id BIGINT,
  p_quality INT
)
RETURNS TABLE (
  id BIGINT,
  next_due_at TIMESTAMPTZ,
  interval_days INT,
  ease_factor REAL,
  repetitions INT,
  streak INT,
  review_count INT,
  correct_count INT,
  wrong_count INT,
  last_quality INT,
  last_review_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  q INT := GREATEST(0, LEAST(5, p_quality));
  ef REAL;
  reps INT;
  interval INT;
BEGIN
  SELECT c.ease_factor, c.repetitions, c.interval_days
  INTO ef, reps, interval
  FROM public.user_find_mistake_cards c
  WHERE c.id = p_card_id AND c.user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Find mistake card not found';
  END IF;

  ef := ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  IF ef < 1.3 THEN ef := 1.3; END IF;

  IF q < 3 THEN
    reps := 0;
    interval := 1;
  ELSE
    IF reps = 0 THEN
      interval := 1;
    ELSIF reps = 1 THEN
      interval := 6;
    ELSE
      interval := GREATEST(1, ROUND(interval * ef)::INT);
    END IF;
    reps := reps + 1;
  END IF;

  UPDATE public.user_find_mistake_cards
  SET
    review_count = review_count + 1,
    correct_count = correct_count + CASE WHEN q >= 3 THEN 1 ELSE 0 END,
    wrong_count = wrong_count + CASE WHEN q < 3 THEN 1 ELSE 0 END,
    streak = CASE WHEN q >= 3 THEN streak + 1 ELSE 0 END,
    repetitions = reps,
    interval_days = interval,
    ease_factor = ef,
    last_quality = q,
    last_review_at = now(),
    next_due_at = now() + make_interval(days => interval)
  WHERE id = p_card_id AND user_id = auth.uid();

  RETURN QUERY
  SELECT
    c.id,
    c.next_due_at,
    c.interval_days,
    c.ease_factor,
    c.repetitions,
    c.streak,
    c.review_count,
    c.correct_count,
    c.wrong_count,
    c.last_quality,
    c.last_review_at
  FROM public.user_find_mistake_cards c
  WHERE c.id = p_card_id AND c.user_id = auth.uid();
END;
$$;
