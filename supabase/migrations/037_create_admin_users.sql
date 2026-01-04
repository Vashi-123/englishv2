-- Admin users table for partner portal admin access

CREATE TABLE IF NOT EXISTS admin_users (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_admin_users_updated_at ON admin_users;
CREATE TRIGGER trigger_update_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION update_admin_users_updated_at();

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write admin users
DROP POLICY IF EXISTS "Read admin users (blocked)" ON admin_users;
CREATE POLICY "Read admin users (blocked)"
  ON admin_users FOR SELECT
  USING (false);

DROP POLICY IF EXISTS "Insert admin users (blocked)" ON admin_users;
CREATE POLICY "Insert admin users (blocked)"
  ON admin_users FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Update admin users (blocked)" ON admin_users;
CREATE POLICY "Update admin users (blocked)"
  ON admin_users FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Delete admin users (blocked)" ON admin_users;
CREATE POLICY "Delete admin users (blocked)"
  ON admin_users FOR DELETE
  USING (false);

-- RPC function to check if user is admin (can be called from edge functions)
CREATE OR REPLACE FUNCTION is_admin_user(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM admin_users
    WHERE LOWER(email) = LOWER(user_email)
  );
END;
$$;

