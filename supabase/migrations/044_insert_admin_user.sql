-- Insert admin user for partner portal access
INSERT INTO public.admin_users (email)
VALUES (LOWER(TRIM('ganaev123@gmail.com')))
ON CONFLICT (email) DO NOTHING;
