-- Таблица для хранения сообщений чата
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  lesson INTEGER NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('vocab', 'grammar', 'correction', 'practice')),
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  text TEXT NOT NULL,
  translation TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  message_order INTEGER NOT NULL
);

-- Индекс для быстрого поиска сообщений урока
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_lesson ON chat_messages(user_id, day, lesson, message_order);

-- RLS политики
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Пользователи могут видеть только свои сообщения
CREATE POLICY "Users can view own messages"
  ON chat_messages FOR SELECT
  USING (auth.uid() = user_id);

-- Пользователи могут создавать свои сообщения
CREATE POLICY "Users can insert own messages"
  ON chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Пользователи могут удалять свои сообщения
CREATE POLICY "Users can delete own messages"
  ON chat_messages FOR DELETE
  USING (auth.uid() = user_id);

