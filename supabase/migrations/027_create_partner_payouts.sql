-- Partner payouts table to track when and how much was paid to partners

CREATE TABLE IF NOT EXISTS partner_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_email TEXT NOT NULL,
  amount_value NUMERIC NOT NULL,
  amount_currency TEXT NOT NULL DEFAULT 'RUB',
  description TEXT,
  payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_email_date
  ON partner_payouts(partner_email, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_payment_date
  ON partner_payouts(payment_date DESC);

CREATE OR REPLACE FUNCTION update_partner_payouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_partner_payouts_updated_at ON partner_payouts;
CREATE TRIGGER trigger_update_partner_payouts_updated_at
  BEFORE UPDATE ON partner_payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_partner_payouts_updated_at();

ALTER TABLE partner_payouts ENABLE ROW LEVEL SECURITY;

-- Partners can view their own payouts
DROP POLICY IF EXISTS "Read own payouts" ON partner_payouts;
CREATE POLICY "Read own payouts"
  ON partner_payouts FOR SELECT
  USING (LOWER(partner_email) = LOWER(auth.jwt() ->> 'email'));

-- No client-side inserts/updates/deletes (only server-side)
DROP POLICY IF EXISTS "Insert payouts (blocked)" ON partner_payouts;
CREATE POLICY "Insert payouts (blocked)"
  ON partner_payouts FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Update payouts (blocked)" ON partner_payouts;
CREATE POLICY "Update payouts (blocked)"
  ON partner_payouts FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Delete payouts (blocked)" ON partner_payouts;
CREATE POLICY "Delete payouts (blocked)"
  ON partner_payouts FOR DELETE
  USING (false);

