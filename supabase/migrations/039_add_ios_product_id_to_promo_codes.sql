-- Add ios_product_id column to promo_codes for iOS IAP product identifier
-- When a promo code is applied, it will use this ios_product_id instead of the default one

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS ios_product_id TEXT;

-- Index for searching by ios_product_id
CREATE INDEX IF NOT EXISTS idx_promo_codes_ios_product_id
  ON promo_codes(ios_product_id)
  WHERE ios_product_id IS NOT NULL;

-- Comment
COMMENT ON COLUMN promo_codes.ios_product_id IS 
  'iOS IAP product identifier to use when this promo code is applied. If NULL, uses the default product from billing_products.ios_product_id';

