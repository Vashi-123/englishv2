-- Add promo_code column to payments table to track which promo code was used

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS promo_code TEXT;

-- Index for searching payments by promo code
CREATE INDEX IF NOT EXISTS idx_payments_promo_code
  ON payments(promo_code)
  WHERE promo_code IS NOT NULL;

