-- Таблица для хранения информации о версиях приложения
CREATE TABLE IF NOT EXISTS app_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  min_version TEXT,
  force_update BOOLEAN DEFAULT false,
  update_url TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для быстрого поиска последней версии
CREATE INDEX IF NOT EXISTS idx_app_versions_created_at ON app_versions(created_at DESC);

-- RLS политики (публичный доступ для чтения)
ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;

-- Политика: все могут читать версии
CREATE POLICY "Anyone can read app versions"
  ON app_versions
  FOR SELECT
  USING (true);

-- Политика: только аутентифицированные пользователи с правами могут изменять
-- (нужно будет настроить в зависимости от вашей системы прав)
CREATE POLICY "Authenticated users can manage app versions"
  ON app_versions
  FOR ALL
  USING (auth.role() = 'authenticated');

-- Комментарии
COMMENT ON TABLE app_versions IS 'Информация о версиях приложения для проверки обновлений';
COMMENT ON COLUMN app_versions.version IS 'Номер версии (например, 1.0.0)';
COMMENT ON COLUMN app_versions.min_version IS 'Минимальная поддерживаемая версия';
COMMENT ON COLUMN app_versions.force_update IS 'Требуется ли принудительное обновление';
COMMENT ON COLUMN app_versions.update_url IS 'URL для обновления (App Store, Play Store, или веб-страница)';
COMMENT ON COLUMN app_versions.message IS 'Сообщение для пользователя при обновлении';

