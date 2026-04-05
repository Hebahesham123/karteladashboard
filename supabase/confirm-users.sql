-- Confirm all existing auth users (mark emails as verified)
UPDATE auth.users
SET 
  email_confirmed_at = NOW(),
  updated_at = NOW()
WHERE email_confirmed_at IS NULL;

-- Verify
SELECT email, email_confirmed_at FROM auth.users ORDER BY created_at DESC;
