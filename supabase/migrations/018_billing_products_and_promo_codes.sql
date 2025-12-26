-- Billing config stored in DB (price + promo codes)

-- Product catalog (public-readable for showing price in UI)
CREATE TABLE IF NOT EXISTS billing_products (
  key TEXT PRIMARY KEY, -- e.g. 'premium_a1'
  title TEXT NOT NULL,
  price_value NUMERIC NOT NULL,
  price_currency TEXT NOT NULL DEFAULT 'RUB',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_billing_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_billing_products_updated_at ON billing_products;
CREATE TRIGGER trigger_update_billing_products_updated_at
  BEFORE UPDATE ON billing_products
  FOR EACH ROW
  EXECUTE FUNCTION update_billing_products_updated_at();

ALTER TABLE billing_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read billing products" ON billing_products;
CREATE POLICY "Read billing products"
  ON billing_products FOR SELECT
  USING (true);

-- No client-side writes.
DROP POLICY IF EXISTS "Insert billing products (blocked)" ON billing_products;
CREATE POLICY "Insert billing products (blocked)"
  ON billing_products FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Update billing products (blocked)" ON billing_products;
CREATE POLICY "Update billing products (blocked)"
  ON billing_products FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Delete billing products (blocked)" ON billing_products;
CREATE POLICY "Delete billing products (blocked)"
  ON billing_products FOR DELETE
  USING (false);

-- Promo codes (NOT public-readable; used only by server-side functions)
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  product_key TEXT REFERENCES billing_products(key) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed','free')),
  value NUMERIC, -- percent (0-100) or fixed final price, depending on kind; NULL for 'free'
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code_active
  ON promo_codes(code, active);

CREATE OR REPLACE FUNCTION update_promo_codes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_promo_codes_updated_at ON promo_codes;
CREATE TRIGGER trigger_update_promo_codes_updated_at
  BEFORE UPDATE ON promo_codes
  FOR EACH ROW
  EXECUTE FUNCTION update_promo_codes_updated_at();

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

-- Block direct access; edge functions use service role.
DROP POLICY IF EXISTS "Read promo codes (blocked)" ON promo_codes;
CREATE POLICY "Read promo codes (blocked)"
  ON promo_codes FOR SELECT
  USING (false);

DROP POLICY IF EXISTS "Insert promo codes (blocked)" ON promo_codes;
CREATE POLICY "Insert promo codes (blocked)"
  ON promo_codes FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Update promo codes (blocked)" ON promo_codes;
CREATE POLICY "Update promo codes (blocked)"
  ON promo_codes FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Delete promo codes (blocked)" ON promo_codes;
CREATE POLICY "Delete promo codes (blocked)"
  ON promo_codes FOR DELETE
  USING (false);

-- Seed: Premium A1 product
INSERT INTO billing_products (key, title, price_value, price_currency, active)
VALUES ('premium_a1', 'Premium A1 (100 lessons)', 1500.00, 'RUB', true)
ON CONFLICT (key) DO UPDATE
SET title = EXCLUDED.title,
    price_value = EXCLUDED.price_value,
    price_currency = EXCLUDED.price_currency,
    active = EXCLUDED.active;
