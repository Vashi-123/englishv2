-- Harden RLS so authenticated users' rows are private, while keeping local-user mode working.
-- Rule:
-- - If row.user_id IS NOT NULL => only that auth user can read/write.
-- - If row.user_id IS NULL => allow (local-user mode).

-- chat_messages
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view own messages" ON chat_messages;
DROP POLICY IF EXISTS "Anyone can insert messages" ON chat_messages;
DROP POLICY IF EXISTS "Anyone can delete messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can view own messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can update own messages" ON chat_messages;

CREATE POLICY "Read chat messages"
  ON chat_messages FOR SELECT
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Insert chat messages"
  ON chat_messages FOR INSERT
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Update chat messages"
  ON chat_messages FOR UPDATE
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Delete chat messages"
  ON chat_messages FOR DELETE
  USING (user_id IS NULL OR auth.uid() = user_id);

-- lesson_progress
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Anyone can insert lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Anyone can update lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Anyone can delete lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Users can view lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Users can insert lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Users can update lesson progress" ON lesson_progress;
DROP POLICY IF EXISTS "Users can delete lesson progress" ON lesson_progress;

CREATE POLICY "Read lesson progress"
  ON lesson_progress FOR SELECT
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Insert lesson progress"
  ON lesson_progress FOR INSERT
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Update lesson progress"
  ON lesson_progress FOR UPDATE
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Delete lesson progress"
  ON lesson_progress FOR DELETE
  USING (user_id IS NULL OR auth.uid() = user_id);

