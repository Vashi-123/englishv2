-- Таблица для локальных пользователей (без авторизации)
CREATE TABLE IF NOT EXISTS local_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT UNIQUE NOT NULL, -- ID из localStorage
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индекс для быстрого поиска по local_id
CREATE INDEX IF NOT EXISTS idx_local_users_local_id ON local_users(local_id);

-- RLS политики - все могут читать и создавать
ALTER TABLE local_users ENABLE ROW LEVEL SECURITY;

-- Все могут видеть всех пользователей (для простоты)
CREATE POLICY "Anyone can view local users"
  ON local_users FOR SELECT
  USING (true);

-- Все могут создавать пользователей
CREATE POLICY "Anyone can insert local users"
  ON local_users FOR INSERT
  WITH CHECK (true);

-- Все могут обновлять свои записи (по local_id через приложение)
CREATE POLICY "Anyone can update local users"
  ON local_users FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Обновляем chat_messages чтобы использовать local_user_id вместо user_id
ALTER TABLE chat_messages 
  DROP CONSTRAINT IF EXISTS chat_messages_user_id_fkey,
  ADD COLUMN IF NOT EXISTS local_user_id TEXT REFERENCES local_users(local_id) ON DELETE CASCADE;

-- Обновляем chat_progress аналогично
ALTER TABLE chat_progress 
  DROP CONSTRAINT IF EXISTS chat_progress_user_id_fkey,
  DROP CONSTRAINT IF EXISTS chat_progress_user_id_day_lesson_key,
  ADD COLUMN IF NOT EXISTS local_user_id TEXT REFERENCES local_users(local_id) ON DELETE CASCADE;

-- Создаем уникальное ограничение для local_user_id
ALTER TABLE chat_progress 
  ADD CONSTRAINT chat_progress_local_user_day_lesson_key UNIQUE (local_user_id, day, lesson);

-- Создаем индексы для local_user_id
CREATE INDEX IF NOT EXISTS idx_chat_messages_local_user ON chat_messages(local_user_id, day, lesson);
CREATE INDEX IF NOT EXISTS idx_chat_progress_local_user ON chat_progress(local_user_id, day, lesson);

-- Обновляем RLS политики для chat_messages
DROP POLICY IF EXISTS "Users can view own messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON chat_messages;

CREATE POLICY "Anyone can view own messages"
  ON chat_messages FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert messages"
  ON chat_messages FOR INSERT
  WITH CHECK (true);

-- Обновляем RLS политики для chat_progress
DROP POLICY IF EXISTS "Users can view own progress" ON chat_progress;
DROP POLICY IF EXISTS "Users can insert own progress" ON chat_progress;
DROP POLICY IF EXISTS "Users can update own progress" ON chat_progress;

CREATE POLICY "Anyone can view progress"
  ON chat_progress FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert progress"
  ON chat_progress FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update progress"
  ON chat_progress FOR UPDATE
  USING (true)
  WITH CHECK (true);

