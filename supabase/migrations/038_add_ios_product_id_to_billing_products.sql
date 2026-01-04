-- Add ios_product_id column to billing_products for iOS IAP product identifier

ALTER TABLE billing_products
  ADD COLUMN IF NOT EXISTS ios_product_id TEXT;

-- Index for searching by ios_product_id
CREATE INDEX IF NOT EXISTS idx_billing_products_ios_product_id
  ON billing_products(ios_product_id)
  WHERE ios_product_id IS NOT NULL;

-- Update existing product with default ios_product_id if not set
UPDATE billing_products
SET ios_product_id = 'englishv2.premium.a1'
WHERE key = 'premium_a1' AND ios_product_id IS NULL;

