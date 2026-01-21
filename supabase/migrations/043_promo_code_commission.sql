-- Migration: 043_promo_code_commission.sql
-- Description: Replace ios_product_id with commission_percent in promo_codes table

-- 1. Remove the obsolete column
ALTER TABLE public.promo_codes
DROP COLUMN IF EXISTS ios_product_id;

-- 2. Add commission_percent column with default 100
ALTER TABLE public.promo_codes
ADD COLUMN commission_percent INTEGER DEFAULT 100;

-- 3. Add comment for clarity
COMMENT ON COLUMN public.promo_codes.commission_percent IS 'Partner commission percentage (0-100). Default is 100%.';
