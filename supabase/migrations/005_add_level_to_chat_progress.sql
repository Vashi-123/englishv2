-- Add `level` to chat_progress to disambiguate (day, lesson) across levels (A1/A2/...).
-- Also add missing DELETE policies for local-user mode so "restart lesson" can actually clear DB rows.

-- chat_progress: level column + backfill + uniqueness
ALTER TABLE chat_progress
  ADD COLUMN IF NOT EXISTS level TEXT;

UPDATE chat_progress cp
SET level = COALESCE(ls.level, cp.level, 'A1')
FROM lesson_scripts ls
WHERE cp.lesson_id IS NOT NULL
  AND ls.lesson_id = cp.lesson_id;

UPDATE chat_progress
SET level = COALESCE(level, 'A1')
WHERE level IS NULL;

ALTER TABLE chat_progress
  ALTER COLUMN level SET DEFAULT 'A1';

ALTER TABLE chat_progress
  ALTER COLUMN level SET NOT NULL;

ALTER TABLE chat_progress
  DROP CONSTRAINT IF EXISTS chat_progress_local_user_day_lesson_key,
  DROP CONSTRAINT IF EXISTS chat_progress_user_id_day_lesson_key;

ALTER TABLE chat_progress
  ADD CONSTRAINT chat_progress_local_user_day_lesson_level_key UNIQUE (local_user_id, day, lesson, level);

CREATE INDEX IF NOT EXISTS idx_chat_progress_local_user_level
  ON chat_progress(local_user_id, day, lesson, level);

-- chat_messages: allow delete in local-user mode (RLS)
DROP POLICY IF EXISTS "Anyone can delete messages" ON chat_messages;
CREATE POLICY "Anyone can delete messages"
  ON chat_messages FOR DELETE
  USING (true);

-- chat_progress: allow delete in local-user mode (RLS)
DROP POLICY IF EXISTS "Anyone can delete progress" ON chat_progress;
CREATE POLICY "Anyone can delete progress"
  ON chat_progress FOR DELETE
  USING (true);

