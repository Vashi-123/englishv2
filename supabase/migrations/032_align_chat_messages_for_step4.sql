-- Align chat_messages schema with Step4 V2 client usage.
-- This project uses chat_messages keyed by (user_id, lesson_id) with optional current_step_snapshot.
-- The migration is idempotent: it only adds missing columns/indexes and won't drop legacy fields.

DO $$
BEGIN
  IF to_regclass('public.chat_messages') IS NULL THEN
    RETURN;
  END IF;

  -- Ensure lesson_id exists (UUID FK to lesson_scripts.lesson_id)
  BEGIN
    ALTER TABLE public.chat_messages
      ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES public.lesson_scripts(lesson_id) ON DELETE CASCADE;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;

  -- Ensure current_step_snapshot exists
  BEGIN
    ALTER TABLE public.chat_messages
      ADD COLUMN IF NOT EXISTS current_step_snapshot JSONB;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;

  -- message_order: allow NULLs for insert without round-trips
  BEGIN
    ALTER TABLE public.chat_messages
      ALTER COLUMN message_order DROP NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;

  -- Helpful index for history fetch by lesson_id
  CREATE INDEX IF NOT EXISTS idx_chat_messages_user_lesson_created_at
    ON public.chat_messages(user_id, lesson_id, created_at, id);
END;
$$;

