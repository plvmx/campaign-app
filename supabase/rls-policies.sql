-- =============================================================================
-- Row-Level Security (RLS) Policies — Campaign App
--
-- Apply via: Supabase Dashboard → SQL Editor, or `supabase db push`.
-- Review each policy against your current dashboard state before applying.
-- All tables must have RLS ENABLED for policies to be enforced.
-- =============================================================================


-- =============================================================================
-- Helper: is_admin()
-- Returns true if the current JWT user has admin = 'AD' in state_leaders.
-- Used as the "admin" predicate in write-restricted tables.
-- =============================================================================
CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM state_leaders sl
    JOIN user_profiles up
      ON up.state = sl.state
     AND lower(trim(up.name)) = lower(trim(sl.leader))
    WHERE up.user_id = auth.uid()
      AND sl.admin = 'AD'
  )
$$;


-- =============================================================================
-- campaigns
-- Leaders see only their own campaigns (plus shared ones via leader_shares).
-- Admins see all.
-- =============================================================================
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns: authenticated users can read own or shared" ON campaigns;
CREATE POLICY "campaigns: authenticated users can read own or shared"
  ON campaigns FOR SELECT
  TO authenticated
  USING (
    auth.is_admin()
    OR (
      -- Own campaign
      EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.user_id = auth.uid()
          AND up.state   = campaigns.state
          AND lower(trim(up.name)) = lower(trim(campaigns.leader))
      )
    )
    OR (
      -- Shared campaign
      EXISTS (
        SELECT 1 FROM leader_shares ls
        JOIN user_profiles up ON up.user_id = auth.uid()
        WHERE ls.shared_with_state  = up.state
          AND lower(trim(ls.shared_with_leader)) = lower(trim(up.name))
          AND ls.owner_state  = campaigns.state
          AND lower(trim(ls.owner_leader)) = lower(trim(campaigns.leader))
      )
    )
  );

DROP POLICY IF EXISTS "campaigns: authenticated users can insert own" ON campaigns;
CREATE POLICY "campaigns: authenticated users can insert own"
  ON campaigns FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.is_admin()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.state   = campaigns.state
        AND lower(trim(up.name)) = lower(trim(campaigns.leader))
    )
  );

DROP POLICY IF EXISTS "campaigns: authenticated users can update own or shared" ON campaigns;
CREATE POLICY "campaigns: authenticated users can update own or shared"
  ON campaigns FOR UPDATE
  TO authenticated
  USING (
    auth.is_admin()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.state   = campaigns.state
        AND lower(trim(up.name)) = lower(trim(campaigns.leader))
    )
    OR EXISTS (
      SELECT 1 FROM leader_shares ls
      JOIN user_profiles up ON up.user_id = auth.uid()
      WHERE ls.shared_with_state  = up.state
        AND lower(trim(ls.shared_with_leader)) = lower(trim(up.name))
        AND ls.owner_state  = campaigns.state
        AND lower(trim(ls.owner_leader)) = lower(trim(campaigns.leader))
    )
  );

DROP POLICY IF EXISTS "campaigns: only owner or admin can delete" ON campaigns;
CREATE POLICY "campaigns: only owner or admin can delete"
  ON campaigns FOR DELETE
  TO authenticated
  USING (
    auth.is_admin()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.state   = campaigns.state
        AND lower(trim(up.name)) = lower(trim(campaigns.leader))
    )
  );


-- =============================================================================
-- state_leaders
-- All authenticated users need SELECT to support login + dropdown population.
-- Only admins can mutate.
-- =============================================================================
ALTER TABLE state_leaders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "state_leaders: authenticated can read" ON state_leaders;
CREATE POLICY "state_leaders: authenticated can read"
  ON state_leaders FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "state_leaders: only admin can insert" ON state_leaders;
CREATE POLICY "state_leaders: only admin can insert"
  ON state_leaders FOR INSERT
  TO authenticated
  WITH CHECK (auth.is_admin());

DROP POLICY IF EXISTS "state_leaders: only admin can update" ON state_leaders;
CREATE POLICY "state_leaders: only admin can update"
  ON state_leaders FOR UPDATE
  TO authenticated
  USING (auth.is_admin());

DROP POLICY IF EXISTS "state_leaders: only admin can delete" ON state_leaders;
CREATE POLICY "state_leaders: only admin can delete"
  ON state_leaders FOR DELETE
  TO authenticated
  USING (auth.is_admin());


-- =============================================================================
-- state_places
-- =============================================================================
ALTER TABLE state_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "state_places: authenticated can read" ON state_places;
CREATE POLICY "state_places: authenticated can read"
  ON state_places FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "state_places: only admin can write" ON state_places;
CREATE POLICY "state_places: only admin can write"
  ON state_places FOR ALL TO authenticated
  USING (auth.is_admin()) WITH CHECK (auth.is_admin());


-- =============================================================================
-- campaign_rules
-- =============================================================================
ALTER TABLE campaign_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_rules: authenticated can read" ON campaign_rules;
CREATE POLICY "campaign_rules: authenticated can read"
  ON campaign_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "campaign_rules: only admin can write" ON campaign_rules;
CREATE POLICY "campaign_rules: only admin can write"
  ON campaign_rules FOR ALL TO authenticated
  USING (auth.is_admin()) WITH CHECK (auth.is_admin());


-- =============================================================================
-- campaign_categories
-- =============================================================================
ALTER TABLE campaign_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_categories: authenticated can read" ON campaign_categories;
CREATE POLICY "campaign_categories: authenticated can read"
  ON campaign_categories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "campaign_categories: only admin can write" ON campaign_categories;
CREATE POLICY "campaign_categories: only admin can write"
  ON campaign_categories FOR ALL TO authenticated
  USING (auth.is_admin()) WITH CHECK (auth.is_admin());


-- =============================================================================
-- campaign_messages
-- =============================================================================
ALTER TABLE campaign_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_messages: authenticated can read" ON campaign_messages;
CREATE POLICY "campaign_messages: authenticated can read"
  ON campaign_messages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "campaign_messages: only admin can write" ON campaign_messages;
CREATE POLICY "campaign_messages: only admin can write"
  ON campaign_messages FOR ALL TO authenticated
  USING (auth.is_admin()) WITH CHECK (auth.is_admin());


-- =============================================================================
-- app_settings
-- All authenticated users need SELECT (feature flags are read on page load).
-- Writes go through /api/admin/settings (service role), so no anon write policy
-- is needed — deny all anon writes to catch any direct-client attempts.
-- =============================================================================
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings: authenticated can read" ON app_settings;
CREATE POLICY "app_settings: authenticated can read"
  ON app_settings FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policy for authenticated role.
-- Mutations go through supabaseAdmin (service role) via /api/admin/settings.


-- =============================================================================
-- user_profiles
-- Users may only read and write their own profile row.
-- =============================================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles: users manage own row" ON user_profiles;
CREATE POLICY "user_profiles: users manage own row"
  ON user_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- user_roles
-- Read-only for authenticated users (own row only).
-- Writes via service role only (set during completeSignIn).
-- =============================================================================
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles: users read own row" ON user_roles;
CREATE POLICY "user_roles: users read own row"
  ON user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- No write policy for authenticated role — managed by service role.


-- =============================================================================
-- campaign_changes_log  (append-only audit trail)
-- Admins can read all. Authenticated users can insert (for logging their own
-- changes). No update or delete — audit entries must be immutable.
-- =============================================================================
ALTER TABLE campaign_changes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_changes_log: admin can read" ON campaign_changes_log;
CREATE POLICY "campaign_changes_log: admin can read"
  ON campaign_changes_log FOR SELECT TO authenticated
  USING (auth.is_admin());

DROP POLICY IF EXISTS "campaign_changes_log: authenticated can insert" ON campaign_changes_log;
CREATE POLICY "campaign_changes_log: authenticated can insert"
  ON campaign_changes_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No UPDATE or DELETE policies.


-- =============================================================================
-- app_events  (analytics, append-only)
-- =============================================================================
ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_events: admin can read" ON app_events;
CREATE POLICY "app_events: admin can read"
  ON app_events FOR SELECT TO authenticated
  USING (auth.is_admin());

DROP POLICY IF EXISTS "app_events: authenticated can insert own" ON app_events;
CREATE POLICY "app_events: authenticated can insert own"
  ON app_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- leader_shares
-- =============================================================================
ALTER TABLE leader_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leader_shares: authenticated can read relevant rows" ON leader_shares;
CREATE POLICY "leader_shares: authenticated can read relevant rows"
  ON leader_shares FOR SELECT TO authenticated
  USING (
    auth.is_admin()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND (
          -- Rows where you are the owner
          (up.state = leader_shares.owner_state
           AND lower(trim(up.name)) = lower(trim(leader_shares.owner_leader)))
          OR
          -- Rows where campaigns are shared with you
          (up.state = leader_shares.shared_with_state
           AND lower(trim(up.name)) = lower(trim(leader_shares.shared_with_leader)))
        )
    )
  );

DROP POLICY IF EXISTS "leader_shares: only admin can write" ON leader_shares;
CREATE POLICY "leader_shares: only admin can write"
  ON leader_shares FOR ALL TO authenticated
  USING (auth.is_admin()) WITH CHECK (auth.is_admin());


-- =============================================================================
-- weekly_refresh_log  (append-only, admin read)
-- Writes go through service role (cron job / admin UI via supabaseAdmin).
-- =============================================================================
ALTER TABLE weekly_refresh_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_refresh_log: admin can read" ON weekly_refresh_log;
CREATE POLICY "weekly_refresh_log: admin can read"
  ON weekly_refresh_log FOR SELECT TO authenticated
  USING (auth.is_admin());

-- No authenticated write policy — managed by service role only.
