-- Add email column to promo_codes table to track partner accounts

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Index for searching promo codes by partner email
CREATE INDEX IF NOT EXISTS idx_promo_codes_email
  ON promo_codes(email)
  WHERE email IS NOT NULL;

