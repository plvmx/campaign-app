-- Improve app_settings RLS: restrict to authenticated users only
-- Note: Admin check is done in application code before showing/saving settings.
-- These policies prevent unauthenticated access. For stricter admin-only RLS,
-- you would need a PostgreSQL function that checks user_roles/state_leaders.

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Admins can view settings" ON app_settings;
DROP POLICY IF EXISTS "Admins can insert settings" ON app_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON app_settings;

-- Only authenticated users can access (admin check in app)
CREATE POLICY "Authenticated users can view app settings"
  ON app_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert app settings"
  ON app_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update app settings"
  ON app_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
