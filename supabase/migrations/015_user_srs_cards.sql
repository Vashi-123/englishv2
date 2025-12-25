-- SRS (Spaced Repetition System) cards for user vocabulary review.
-- Uses SM-2 style scheduling (SuperMemo 2) with quality 0..5.

-- Table
CREATE TABLE IF NOT EXISTS user_srs_cards (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'A1',
  source_lang TEXT NOT NULL DEFAULT 'en',
  target_lang TEXT NOT NULL,
  word TEXT NOT NULL,
  word_norm TEXT NOT NULL,
  translation TEXT NOT NULL,

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

CREATE UNIQUE INDEX IF NOT EXISTS user_srs_cards_unique
  ON user_srs_cards(user_id, source_lang, target_lang, word_norm);

CREATE INDEX IF NOT EXISTS idx_user_srs_cards_due
  ON user_srs_cards(user_id, source_lang, target_lang, level, next_due_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_srs_cards_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_user_srs_cards_set_updated_at
      BEFORE UPDATE ON user_srs_cards
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- RLS
ALTER TABLE user_srs_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read srs cards" ON user_srs_cards;
DROP POLICY IF EXISTS "Insert srs cards" ON user_srs_cards;
DROP POLICY IF EXISTS "Update srs cards" ON user_srs_cards;
DROP POLICY IF EXISTS "Delete srs cards" ON user_srs_cards;

CREATE POLICY "Read srs cards"
  ON user_srs_cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Insert srs cards"
  ON user_srs_cards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update srs cards"
  ON user_srs_cards FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Delete srs cards"
  ON user_srs_cards FOR DELETE
  USING (auth.uid() = user_id);

-- RPC: fetch a review batch (due-first, then fill)
CREATE OR REPLACE FUNCTION get_srs_review_batch(
  p_level TEXT,
  p_source_lang TEXT,
  p_target_lang TEXT,
  p_limit INT DEFAULT 8
)
RETURNS TABLE (
  id BIGINT,
  word TEXT,
  translation TEXT
)
LANGUAGE SQL
STABLE
AS $$
  WITH due AS (
    SELECT c.id, c.word, c.translation
    FROM user_srs_cards c
    WHERE c.user_id = auth.uid()
      AND c.level = p_level
      AND c.source_lang = p_source_lang
      AND c.target_lang = p_target_lang
      AND c.next_due_at IS NOT NULL
      AND c.next_due_at <= now()
    ORDER BY c.next_due_at ASC, c.wrong_count DESC, c.review_count ASC
    LIMIT GREATEST(0, p_limit)
  ),
  fill AS (
    SELECT c.id, c.word, c.translation
    FROM user_srs_cards c
    WHERE c.user_id = auth.uid()
      AND c.level = p_level
      AND c.source_lang = p_source_lang
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

-- RPC: apply an SM-2 style review update (quality 0..5)
CREATE OR REPLACE FUNCTION apply_srs_review(
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
  FROM user_srs_cards c
  WHERE c.id = p_card_id AND c.user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SRS card not found';
  END IF;

  -- SM-2 EF update
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

  UPDATE user_srs_cards
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
  FROM user_srs_cards c
  WHERE c.id = p_card_id AND c.user_id = auth.uid();
END;
$$;
