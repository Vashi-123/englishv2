-- Switch schema to auth-only identity (user_id UUID) and remove legacy local_user_id paths.
-- This migration is idempotent and safe to run on DBs that already removed local_user_id manually.

-- lesson_progress: enforce user_id-only identity
DO $$
BEGIN
  BEGIN
    ALTER TABLE lesson_progress
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION
    WHEN undefined_table THEN
      RETURN;
  END;

  -- Drop legacy local-user column if still present
  BEGIN
    ALTER TABLE lesson_progress
      DROP COLUMN IF EXISTS local_user_id;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;

  -- Remove any legacy rows (local-user mode) before hardening constraints
  BEGIN
    EXECUTE 'DELETE FROM lesson_progress WHERE user_id IS NULL';
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;

  -- Tighten identity constraints
  ALTER TABLE lesson_progress
    DROP CONSTRAINT IF EXISTS lesson_progress_identity_check;

  ALTER TABLE lesson_progress
    ADD CONSTRAINT lesson_progress_identity_check CHECK (user_id IS NOT NULL);

  -- Ensure user_id is required
  BEGIN
    ALTER TABLE lesson_progress
      ALTER COLUMN user_id SET NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;
END;
$$;

-- Replace unique/indexes for auth-only identity
DROP INDEX IF EXISTS lesson_progress_local_user_lesson_uidx;
DROP INDEX IF EXISTS idx_lesson_progress_local_user_lesson;

CREATE UNIQUE INDEX IF NOT EXISTS lesson_progress_user_lesson_uidx
  ON lesson_progress(user_id, lesson_id);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_user_lesson
  ON lesson_progress(user_id, lesson_id);

-- chat_messages: remove legacy local_user_id and index by user_id
DO $$
BEGIN
  BEGIN
    ALTER TABLE chat_messages
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION
    WHEN undefined_table THEN
      RETURN;
  END;

  -- Remove any legacy rows (local-user mode) before hardening constraints
  BEGIN
    EXECUTE 'DELETE FROM chat_messages WHERE user_id IS NULL';
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;

  -- Drop legacy local-user column if still present
  BEGIN
    ALTER TABLE chat_messages
      DROP COLUMN IF EXISTS local_user_id;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;

  -- Ensure user_id is required
  BEGIN
    ALTER TABLE chat_messages
      ALTER COLUMN user_id SET NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;
END;
$$;

DROP INDEX IF EXISTS idx_chat_messages_local_user;
DROP INDEX IF EXISTS idx_chat_messages_local_user_lesson_created_at;

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_lesson_created_at
  ON chat_messages(user_id, lesson_id, created_at, id);

-- RLS: strict auth-only policies
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;

-- chat_messages policies
DROP POLICY IF EXISTS "Read chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Insert chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Update chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Delete chat messages" ON chat_messages;

CREATE POLICY "Read chat messages"
  ON chat_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Insert chat messages"
  ON chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update chat messages"
  ON chat_messages FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Delete chat messages"
  ON chat_messages FOR DELETE
  USING (auth.uid() = user_id);

-- lesson_progress policies
DROP POLICY IF EXISTS "Read lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Insert lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Update lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Delete lesson progress" ON lesson_progress;

CREATE POLICY "Read lesson progress"
  ON lesson_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Insert lesson progress"
  ON lesson_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update lesson progress"
  ON lesson_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Delete lesson progress"
  ON lesson_progress FOR DELETE
  USING (auth.uid() = user_id);

