-- Fix PostgREST upsert target for lesson_progress.
-- Some earlier migrations created a PARTIAL unique index on (user_id, lesson_id),
-- which does not satisfy `ON CONFLICT (user_id, lesson_id)`.
-- We drop any such index/constraint and recreate a full unique constraint.

DO $$
BEGIN
  -- If the table doesn't exist, nothing to do.
  IF to_regclass('public.lesson_progress') IS NULL THEN
    RETURN;
  END IF;

  -- Drop any existing constraint that might be present.
  BEGIN
    ALTER TABLE public.lesson_progress
      DROP CONSTRAINT IF EXISTS lesson_progress_user_lesson_key;
  EXCEPTION
    WHEN undefined_object THEN
      NULL;
  END;

  -- Drop any existing unique index (partial or otherwise) so we can recreate it without a predicate.
  -- (A partial unique index won't match PostgREST's `on_conflict=user_id,lesson_id`.)
  DROP INDEX IF EXISTS public.lesson_progress_user_lesson_uidx;

  -- Recreate as a full unique constraint (preferred for clarity).
  ALTER TABLE public.lesson_progress
    ADD CONSTRAINT lesson_progress_user_lesson_key UNIQUE (user_id, lesson_id);
END;
$$;

