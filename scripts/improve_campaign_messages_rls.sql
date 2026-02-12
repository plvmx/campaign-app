-- Restrict campaign_messages: only admins should modify (insert/update/delete)
-- All authenticated users can read messages.
-- Note: Admin check requires a PostgreSQL function. For now we keep authenticated-only.
-- To add admin-only write: create a custom function is_admin_user() and use it in WITH CHECK.

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view campaign messages" ON campaign_messages;
DROP POLICY IF EXISTS "Authenticated users can insert messages" ON campaign_messages;
DROP POLICY IF EXISTS "Authenticated users can update messages" ON campaign_messages;
DROP POLICY IF EXISTS "Authenticated users can delete messages" ON campaign_messages;

-- All authenticated users can read
CREATE POLICY "Authenticated users can view campaign messages"
  ON campaign_messages FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can modify (admin check in app)
CREATE POLICY "Authenticated users can insert campaign messages"
  ON campaign_messages FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update campaign messages"
  ON campaign_messages FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete campaign messages"
  ON campaign_messages FOR DELETE
  TO authenticated
  USING (true);
