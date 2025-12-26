-- Premium entitlement + payment tracking (YooKassa)

-- 1) User entitlement (1 row per user)
CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  premium_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_user_entitlements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_entitlements_updated_at ON user_entitlements;
CREATE TRIGGER trigger_update_user_entitlements_updated_at
  BEFORE UPDATE ON user_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION update_user_entitlements_updated_at();

ALTER TABLE user_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own entitlements" ON user_entitlements;
CREATE POLICY "Read own entitlements"
  ON user_entitlements FOR SELECT
  USING (auth.uid() = user_id);

-- Users should not be able to grant themselves premium.
DROP POLICY IF EXISTS "Insert own entitlements (blocked)" ON user_entitlements;
CREATE POLICY "Insert own entitlements (blocked)"
  ON user_entitlements FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Update own entitlements (blocked)" ON user_entitlements;
CREATE POLICY "Update own entitlements (blocked)"
  ON user_entitlements FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- 2) Payment records (written by server-side code / edge functions)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'yookassa',
  provider_payment_id TEXT UNIQUE,
  idempotence_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  amount_value NUMERIC,
  amount_currency TEXT,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id_created_at
  ON payments(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_payments_updated_at ON payments;
CREATE TRIGGER trigger_update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_payments_updated_at();

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Users may view their own payment history (optional, but useful for "restore purchase" UX).
DROP POLICY IF EXISTS "Read own payments" ON payments;
CREATE POLICY "Read own payments"
  ON payments FOR SELECT
  USING (auth.uid() = user_id);

-- No client-side inserts/updates/deletes.
DROP POLICY IF EXISTS "Insert payments (blocked)" ON payments;
CREATE POLICY "Insert payments (blocked)"
  ON payments FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Update payments (blocked)" ON payments;
CREATE POLICY "Update payments (blocked)"
  ON payments FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Delete payments (blocked)" ON payments;
CREATE POLICY "Delete payments (blocked)"
  ON payments FOR DELETE
  USING (false);

