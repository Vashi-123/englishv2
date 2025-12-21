-- Make chat_messages.message_order optional so clients can insert without a "max(message_order)" round-trip.
-- Ordering should prefer created_at + id.

DO $$
BEGIN
  -- Ensure created_at exists with a default
  BEGIN
    ALTER TABLE chat_messages
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  EXCEPTION
    WHEN undefined_table THEN
      RETURN;
  END;

  -- message_order: allow NULLs
  BEGIN
    ALTER TABLE chat_messages
      ALTER COLUMN message_order DROP NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;
END;
$$;

-- Index for fast lesson history fetch
CREATE INDEX IF NOT EXISTS idx_chat_messages_local_user_lesson_created_at
  ON chat_messages(local_user_id, lesson_id, created_at, id);

