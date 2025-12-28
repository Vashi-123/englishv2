-- Store user email alongside entitlements (denormalized from auth.users).

ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill email for existing rows.
UPDATE public.user_entitlements e
SET email = u.email
FROM auth.users u
WHERE u.id = e.user_id
  AND (e.email IS DISTINCT FROM u.email);

-- Ensure new users get email persisted in entitlements.
CREATE OR REPLACE FUNCTION public.handle_new_user_entitlements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_entitlements (user_id, email, is_premium, paid, premium_until, created_at, updated_at)
  VALUES (NEW.id, NEW.email, FALSE, FALSE, NULL, NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- Keep email synced if it changes later (e.g., user updates email).
CREATE OR REPLACE FUNCTION public.sync_user_entitlements_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.email IS DISTINCT FROM OLD.email) THEN
    UPDATE public.user_entitlements
    SET email = NEW.email
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated_entitlements_email ON auth.users;
CREATE TRIGGER on_auth_user_updated_entitlements_email
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_entitlements_email();

