-- Ensure every user has an entitlements row + track whether premium came from payment.

-- 1) Add `paid` flag (true = premium acquired via payment, false = granted manually / free).
ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Backfill missing rows for all existing users.
INSERT INTO public.user_entitlements (user_id, is_premium, paid, premium_until, created_at, updated_at)
SELECT
  u.id AS user_id,
  FALSE AS is_premium,
  FALSE AS paid,
  NULL::timestamptz AS premium_until,
  NOW() AS created_at,
  NOW() AS updated_at
FROM auth.users u
LEFT JOIN public.user_entitlements e ON e.user_id = u.id
WHERE e.user_id IS NULL;

-- 3) Mark entitlements as `paid` when we have a successful payment record.
UPDATE public.user_entitlements e
SET paid = EXISTS (
  SELECT 1
  FROM public.payments p
  WHERE p.user_id = e.user_id
    AND p.status IN ('succeeded', 'paid', 'success')
);

-- 4) Auto-create entitlements row on new signups.
CREATE OR REPLACE FUNCTION public.handle_new_user_entitlements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_entitlements (user_id, is_premium, paid, premium_until, created_at, updated_at)
  VALUES (NEW.id, FALSE, FALSE, NULL, NOW(), NOW())
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_entitlements ON auth.users;
CREATE TRIGGER on_auth_user_created_entitlements
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_entitlements();

