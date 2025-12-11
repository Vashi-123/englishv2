-- Таблица для отслеживания прогресса модулей в чате
CREATE TABLE IF NOT EXISTS chat_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  lesson INTEGER NOT NULL,
  current_module TEXT NOT NULL CHECK (current_module IN ('vocab', 'grammar', 'correction', 'practice')),
  vocab_completed BOOLEAN DEFAULT false,
  grammar_completed BOOLEAN DEFAULT false,
  correction_completed BOOLEAN DEFAULT false,
  practice_completed BOOLEAN DEFAULT false,
  messages_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, day, lesson)
);

-- Индекс для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_chat_progress_user_day ON chat_progress(user_id, day, lesson);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_chat_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления updated_at
CREATE TRIGGER trigger_update_chat_progress_updated_at
  BEFORE UPDATE ON chat_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_progress_updated_at();

-- RLS политики
ALTER TABLE chat_progress ENABLE ROW LEVEL SECURITY;

-- Пользователи могут видеть только свой прогресс
CREATE POLICY "Users can view own progress"
  ON chat_progress FOR SELECT
  USING (auth.uid() = user_id);

-- Пользователи могут создавать свой прогресс
CREATE POLICY "Users can insert own progress"
  ON chat_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Пользователи могут обновлять свой прогресс
CREATE POLICY "Users can update own progress"
  ON chat_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

