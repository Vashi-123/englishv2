-- Ensure lesson_progress supports PostgREST upsert with on_conflict=local_user_id,lesson_id.
-- The live DB may already have lesson_progress created without the required unique indexes.

DO $$
BEGIN
  -- If the table doesn't exist, nothing to do.
  PERFORM 1 FROM pg_class WHERE relname = 'lesson_progress' AND relkind = 'r';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Unique index for local-user mode upserts.
  -- Partial index keeps compatibility with rows that use auth user_id instead.
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS lesson_progress_local_user_lesson_uidx
           ON lesson_progress(local_user_id, lesson_id)
           WHERE local_user_id IS NOT NULL';

  -- Optional unique index for auth-user rows (future-proof).
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS lesson_progress_user_lesson_uidx
           ON lesson_progress(user_id, lesson_id)
           WHERE user_id IS NOT NULL';
END;
$$;

