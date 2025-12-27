-- Public app settings (safe to expose to client)

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_int INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_app_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_app_settings_updated_at ON app_settings;
CREATE TRIGGER trigger_update_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_app_settings_updated_at();

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Public read (not secret). Writes are blocked from the client.
DROP POLICY IF EXISTS "Read app settings" ON app_settings;
CREATE POLICY "Read app settings"
  ON app_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Insert app settings (blocked)" ON app_settings;
CREATE POLICY "Insert app settings (blocked)"
  ON app_settings FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Update app settings (blocked)" ON app_settings;
CREATE POLICY "Update app settings (blocked)"
  ON app_settings FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Delete app settings (blocked)" ON app_settings;
CREATE POLICY "Delete app settings (blocked)"
  ON app_settings FOR DELETE
  USING (false);

-- Default: 3 free lessons (can be changed by admins/service role via SQL).
INSERT INTO app_settings (key, value_int)
VALUES ('free_lesson_count', 3)
ON CONFLICT (key) DO UPDATE
SET value_int = EXCLUDED.value_int,
    updated_at = NOW();

