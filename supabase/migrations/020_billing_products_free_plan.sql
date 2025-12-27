-- Free plan stored in billing_products so the client can read limits from DB.

ALTER TABLE billing_products
  ADD COLUMN IF NOT EXISTS lesson_access_limit INTEGER;

-- Seed: Free default plan (applies to all non-premium users).
INSERT INTO billing_products (key, title, price_value, price_currency, active, lesson_access_limit)
VALUES ('free_default', 'Free plan', 0.00, 'RUB', true, 3)
ON CONFLICT (key) DO UPDATE
SET title = EXCLUDED.title,
    price_value = EXCLUDED.price_value,
    price_currency = EXCLUDED.price_currency,
    active = EXCLUDED.active,
    lesson_access_limit = EXCLUDED.lesson_access_limit,
    updated_at = NOW();

-- Ensure premium product has a known total lesson cap (for UI, optional).
UPDATE billing_products
SET lesson_access_limit = COALESCE(lesson_access_limit, 100),
    updated_at = NOW()
WHERE key = 'premium_a1';

