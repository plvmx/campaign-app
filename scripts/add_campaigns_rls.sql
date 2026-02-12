-- Add Row Level Security to campaigns table
-- Note: Fine-grained access (own/SR/admin) is enforced in application code.
-- This policy ensures only authenticated users can access campaigns at all.

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running (allows idempotent execution)
DROP POLICY IF EXISTS "Authenticated users can view campaigns" ON campaigns;
DROP POLICY IF EXISTS "Authenticated users can insert campaigns" ON campaigns;
DROP POLICY IF EXISTS "Authenticated users can update campaigns" ON campaigns;
DROP POLICY IF EXISTS "Authenticated users can delete campaigns" ON campaigns;

-- Authenticated users (including anonymous sessions) can SELECT
-- App logic filters by user/state/leader
CREATE POLICY "Authenticated users can view campaigns"
  ON campaigns FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can INSERT
CREATE POLICY "Authenticated users can insert campaigns"
  ON campaigns FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can UPDATE
CREATE POLICY "Authenticated users can update campaigns"
  ON campaigns FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated users can DELETE
CREATE POLICY "Authenticated users can delete campaigns"
  ON campaigns FOR DELETE
  TO authenticated
  USING (true);
