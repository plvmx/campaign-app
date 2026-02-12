-- Secure login validation: PostgreSQL function with SECURITY DEFINER
-- Bypasses RLS so anon users can validate credentials without exposing state_leaders.
-- Run this in Supabase SQL Editor. Then remove the anon policy from state_leaders.

-- Helper: normalize mobile (matches lib/auth.ts normalizeMobile)
CREATE OR REPLACE FUNCTION normalize_mobile(input_mobile TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result TEXT;
BEGIN
  IF input_mobile IS NULL OR input_mobile = '' THEN
    RETURN '';
  END IF;
  result := trim(input_mobile);
  -- Remove +61 prefix
  result := regexp_replace(result, '^\+61\s*', '', 'i');
  -- Remove non-digits
  result := regexp_replace(result, '[^0-9]', '', 'g');
  -- Australian: add leading 0 for 9-digit numbers
  IF length(result) = 9 AND result NOT LIKE '0%' THEN
    result := '0' || result;
  END IF;
  RETURN result;
END;
$$;

-- Main: validate leader for login (callable by anon)
-- Returns matching row or null. SECURITY DEFINER bypasses RLS.
CREATE OR REPLACE FUNCTION validate_leader_for_login(p_mobile TEXT, p_first_name TEXT)
RETURNS TABLE (
  id UUID,
  state TEXT,
  leader TEXT,
  admin TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mobile_norm TEXT;
  v_name_norm TEXT;
  rec RECORD;
  rec_mobile_norm TEXT;
  rec_name_norm TEXT;
BEGIN
  v_mobile_norm := normalize_mobile(p_mobile);
  v_name_norm := lower(trim(coalesce(p_first_name, '')));
  
  IF v_mobile_norm = '' OR v_name_norm = '' THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT sl.id, sl.state, sl.leader, sl.admin
    FROM state_leaders sl
    WHERE sl.mobile IS NOT NULL
  LOOP
    rec_mobile_norm := normalize_mobile(rec.mobile);
    rec_name_norm := lower(trim(coalesce(rec.leader, '')));
    IF rec_mobile_norm = v_mobile_norm AND rec_name_norm = v_name_norm THEN
      id := rec.id;
      state := rec.state;
      leader := rec.leader;
      admin := rec.admin;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

-- Allow anon and authenticated to call (anon needed for pre-login validation)
GRANT EXECUTE ON FUNCTION validate_leader_for_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION validate_leader_for_login(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION validate_leader_for_login IS 'Validates mobile+name against state_leaders for login. SECURITY DEFINER bypasses RLS. Callable by anon.';
