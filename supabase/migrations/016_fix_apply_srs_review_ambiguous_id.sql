-- Fix Postgres 42702: "column reference \"id\" is ambiguous"
-- In plpgsql, RETURNS TABLE column names become variables, so unqualified `id`
-- in the UPDATE clause can conflict with the output column `id`.

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
  WHERE user_srs_cards.id = p_card_id AND user_srs_cards.user_id = auth.uid();

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

