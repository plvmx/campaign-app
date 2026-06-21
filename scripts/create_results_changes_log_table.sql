-- Audit log for the results table.
--
-- One row per save *batch* (not per name) emitted by the Record Results page,
-- so we can later answer "did the names this leader typed actually reach the
-- server, and what happened to them?". Mirrors the campaign_changes_log
-- pattern, but with batch-level shape because saves naturally come in groups
-- (upsert of N names + delete of M names).
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS results_changes_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'ERROR')),
  attempted_upserts JSONB,   -- array of { first_name, category_code } the client tried to upsert
  attempted_deletes JSONB,   -- array of { first_name, category_code } the client tried to delete
  error_message TEXT,        -- populated when status = 'ERROR'
  user_email TEXT,           -- denormalized for easier querying
  user_name TEXT,            -- from user_profiles
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_changes_log_campaign_id ON results_changes_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_results_changes_log_user_id    ON results_changes_log(user_id);
CREATE INDEX IF NOT EXISTS idx_results_changes_log_created_at ON results_changes_log(created_at);
CREATE INDEX IF NOT EXISTS idx_results_changes_log_status     ON results_changes_log(status);

COMMENT ON TABLE  results_changes_log IS 'Audit trail of every Record Results save attempt (success or failure), so name-loss reports can be diagnosed against ground truth.';
COMMENT ON COLUMN results_changes_log.attempted_upserts IS 'JSONB array of {first_name, category_code} the client attempted to upsert in this save batch.';
COMMENT ON COLUMN results_changes_log.attempted_deletes IS 'JSONB array of {first_name, category_code} the client attempted to delete in this save batch.';
COMMENT ON COLUMN results_changes_log.error_message    IS 'Error string from the failed save operation (only set when status = ERROR).';

-- RLS: allow authenticated users to insert their own log rows; reads are admin-only via service role.
ALTER TABLE results_changes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can insert their own results log rows" ON results_changes_log;
CREATE POLICY "Authenticated users can insert their own results log rows"
  ON results_changes_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- SELECT is left to the service role (admin queries / diagnostics scripts).
DROP POLICY IF EXISTS "Authenticated users can read their own results log rows" ON results_changes_log;
CREATE POLICY "Authenticated users can read their own results log rows"
  ON results_changes_log FOR SELECT TO authenticated
  USING (user_id = auth.uid());
