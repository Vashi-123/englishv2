-- Extend user_srs_cards to persist example sentence + its translation (for future Anki),
-- and store stable TTS references (lang/voice + hashes) so example audio can be reused.

-- Columns (idempotent)
ALTER TABLE public.user_srs_cards
  ADD COLUMN IF NOT EXISTS context TEXT,
  ADD COLUMN IF NOT EXISTS context_translation TEXT,
  ADD COLUMN IF NOT EXISTS tts_lang TEXT NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS tts_voice TEXT NOT NULL DEFAULT 'cedar',
  ADD COLUMN IF NOT EXISTS word_tts_hash TEXT,
  ADD COLUMN IF NOT EXISTS context_tts_hash TEXT;

-- RPC: upsert SRS cards from vocab (increment seen_count on conflict)
-- Note: Postgres cannot `CREATE OR REPLACE` a function if OUT/RETURN columns changed.
DROP FUNCTION IF EXISTS public.upsert_srs_cards_from_vocab(text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.upsert_srs_cards_from_vocab(
  p_level TEXT,
  p_source_lang TEXT,
  p_target_lang TEXT,
  p_items JSONB
)
RETURNS TABLE (
  out_id BIGINT,
  out_word_norm TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  it JSONB;
  v_word TEXT;
  v_norm TEXT;
  v_translation TEXT;
  v_context TEXT;
  v_context_translation TEXT;
  v_tts_lang TEXT;
  v_tts_voice TEXT;
  v_word_tts_hash TEXT;
  v_context_tts_hash TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_word := NULLIF(BTRIM(COALESCE(it->>'word', '')), '');
    v_norm := NULLIF(BTRIM(COALESCE(it->>'word_norm', '')), '');
    v_translation := NULLIF(BTRIM(COALESCE(it->>'translation', '')), '');
    v_context := NULLIF(BTRIM(COALESCE(it->>'context', '')), '');
    v_context_translation := NULLIF(BTRIM(COALESCE(it->>'context_translation', '')), '');
    v_tts_lang := NULLIF(BTRIM(COALESCE(it->>'tts_lang', '')), '');
    v_tts_voice := NULLIF(BTRIM(COALESCE(it->>'tts_voice', '')), '');
    v_word_tts_hash := NULLIF(BTRIM(COALESCE(it->>'word_tts_hash', '')), '');
    v_context_tts_hash := NULLIF(BTRIM(COALESCE(it->>'context_tts_hash', '')), '');

    IF v_word IS NULL OR v_norm IS NULL OR v_translation IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.user_srs_cards(
      user_id, level, source_lang, target_lang,
      word, word_norm, translation,
      context, context_translation,
      tts_lang, tts_voice,
      word_tts_hash, context_tts_hash,
      last_seen_at, seen_count
    )
    VALUES (
      auth.uid(), p_level, p_source_lang, p_target_lang,
      v_word, v_norm, v_translation,
      v_context, v_context_translation,
      COALESCE(v_tts_lang, 'en-US'),
      COALESCE(v_tts_voice, 'cedar'),
      v_word_tts_hash,
      v_context_tts_hash,
      now(), 1
    )
    ON CONFLICT (user_id, source_lang, target_lang, word_norm)
    DO UPDATE SET
      word = EXCLUDED.word,
      translation = EXCLUDED.translation,
      context = COALESCE(EXCLUDED.context, public.user_srs_cards.context),
      context_translation = COALESCE(EXCLUDED.context_translation, public.user_srs_cards.context_translation),
      tts_lang = COALESCE(EXCLUDED.tts_lang, public.user_srs_cards.tts_lang),
      tts_voice = COALESCE(EXCLUDED.tts_voice, public.user_srs_cards.tts_voice),
      word_tts_hash = COALESCE(EXCLUDED.word_tts_hash, public.user_srs_cards.word_tts_hash),
      context_tts_hash = COALESCE(EXCLUDED.context_tts_hash, public.user_srs_cards.context_tts_hash),
      last_seen_at = now(),
      seen_count = public.user_srs_cards.seen_count + 1;
  END LOOP;

  RETURN QUERY
  SELECT c.id AS out_id, c.word_norm AS out_word_norm
  FROM public.user_srs_cards c
  WHERE c.user_id = auth.uid()
    AND c.level = p_level
    AND c.source_lang = p_source_lang
    AND c.target_lang = p_target_lang
    AND c.word_norm IN (SELECT (x->>'word_norm') FROM jsonb_array_elements(p_items) x);
END;
$$;

-- RPC: fetch a review batch (include example fields for future UI)
DROP FUNCTION IF EXISTS public.get_srs_review_batch(text, text, text, integer);
CREATE OR REPLACE FUNCTION public.get_srs_review_batch(
  p_level TEXT,
  p_source_lang TEXT,
  p_target_lang TEXT,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  id BIGINT,
  word TEXT,
  translation TEXT,
  context TEXT,
  context_translation TEXT,
  tts_lang TEXT,
  tts_voice TEXT,
  word_tts_hash TEXT,
  context_tts_hash TEXT
)
LANGUAGE SQL
STABLE
AS $$
  WITH due AS (
    SELECT
      c.id,
      c.word,
      c.translation,
      c.context,
      c.context_translation,
      c.tts_lang,
      c.tts_voice,
      c.word_tts_hash,
      c.context_tts_hash
    FROM public.user_srs_cards c
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
    SELECT
      c.id,
      c.word,
      c.translation,
      c.context,
      c.context_translation,
      c.tts_lang,
      c.tts_voice,
      c.word_tts_hash,
      c.context_tts_hash
    FROM public.user_srs_cards c
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

