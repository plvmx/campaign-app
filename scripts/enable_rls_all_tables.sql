-- Enable RLS on all public tables (fixes Supabase Security Advisor errors)
-- Run this in Supabase SQL Editor to resolve "RLS Disabled in Public" issues.
-- Policies allow authenticated users only; app code enforces admin/user/SR permissions.

-- =============================================================================
-- 1. state_leaders (login validation, SR admin, leader lookup)
-- =============================================================================
ALTER TABLE state_leaders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view state_leaders" ON state_leaders;
CREATE POLICY "Authenticated users can view state_leaders"
  ON state_leaders FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert state_leaders" ON state_leaders;
CREATE POLICY "Authenticated users can insert state_leaders"
  ON state_leaders FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update state_leaders" ON state_leaders;
CREATE POLICY "Authenticated users can update state_leaders"
  ON state_leaders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete state_leaders" ON state_leaders;
CREATE POLICY "Authenticated users can delete state_leaders"
  ON state_leaders FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 2. results (campaign results - first_name, category_code per campaign)
-- =============================================================================
ALTER TABLE results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view results" ON results;
CREATE POLICY "Authenticated users can view results"
  ON results FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert results" ON results;
CREATE POLICY "Authenticated users can insert results"
  ON results FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update results" ON results;
CREATE POLICY "Authenticated users can update results"
  ON results FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete results" ON results;
CREATE POLICY "Authenticated users can delete results"
  ON results FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 3. app_config (Security Advisor reports this name; if missing, try app_settings)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_config') THEN
    ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Authenticated users can view app_config" ON app_config;
    CREATE POLICY "Authenticated users can view app_config" ON app_config FOR SELECT TO authenticated USING (true);
    DROP POLICY IF EXISTS "Authenticated users can insert app_config" ON app_config;
    CREATE POLICY "Authenticated users can insert app_config" ON app_config FOR INSERT TO authenticated WITH CHECK (true);
    DROP POLICY IF EXISTS "Authenticated users can update app_config" ON app_config;
    CREATE POLICY "Authenticated users can update app_config" ON app_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS "Authenticated users can delete app_config" ON app_config;
    CREATE POLICY "Authenticated users can delete app_config" ON app_config FOR DELETE TO authenticated USING (true);
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_settings') THEN
    -- Fallback: app_settings (from create_app_settings_table.sql)
    ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Admins can view settings" ON app_settings;
    DROP POLICY IF EXISTS "Admins can insert settings" ON app_settings;
    DROP POLICY IF EXISTS "Admins can update settings" ON app_settings;
    DROP POLICY IF EXISTS "Authenticated users can view app settings" ON app_settings;
    DROP POLICY IF EXISTS "Authenticated users can insert app settings" ON app_settings;
    DROP POLICY IF EXISTS "Authenticated users can update app settings" ON app_settings;
    CREATE POLICY "Authenticated users can view app settings" ON app_settings FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Authenticated users can insert app settings" ON app_settings FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Authenticated users can update app settings" ON app_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- =============================================================================
-- 4. leader_shares (leader-to-leader campaign sharing)
-- =============================================================================
ALTER TABLE leader_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view leader_shares" ON leader_shares;
CREATE POLICY "Authenticated users can view leader_shares"
  ON leader_shares FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert leader_shares" ON leader_shares;
CREATE POLICY "Authenticated users can insert leader_shares"
  ON leader_shares FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update leader_shares" ON leader_shares;
CREATE POLICY "Authenticated users can update leader_shares"
  ON leader_shares FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete leader_shares" ON leader_shares;
CREATE POLICY "Authenticated users can delete leader_shares"
  ON leader_shares FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 5. campaign_changes_log (audit log - insert from app, read by admins)
-- =============================================================================
ALTER TABLE campaign_changes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view campaign_changes_log" ON campaign_changes_log;
CREATE POLICY "Authenticated users can view campaign_changes_log"
  ON campaign_changes_log FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert campaign_changes_log" ON campaign_changes_log;
CREATE POLICY "Authenticated users can insert campaign_changes_log"
  ON campaign_changes_log FOR INSERT TO authenticated WITH CHECK (true);

-- No UPDATE/DELETE on log (append-only)

-- =============================================================================
-- 6. weekly_refresh_log (admin refresh log)
-- =============================================================================
ALTER TABLE weekly_refresh_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view weekly_refresh_log" ON weekly_refresh_log;
CREATE POLICY "Authenticated users can view weekly_refresh_log"
  ON weekly_refresh_log FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert weekly_refresh_log" ON weekly_refresh_log;
CREATE POLICY "Authenticated users can insert weekly_refresh_log"
  ON weekly_refresh_log FOR INSERT TO authenticated WITH CHECK (true);

-- =============================================================================
-- 7. campaign_rules (rule-based campaign generation)
-- =============================================================================
ALTER TABLE campaign_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view campaign_rules" ON campaign_rules;
CREATE POLICY "Authenticated users can view campaign_rules"
  ON campaign_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert campaign_rules" ON campaign_rules;
CREATE POLICY "Authenticated users can insert campaign_rules"
  ON campaign_rules FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update campaign_rules" ON campaign_rules;
CREATE POLICY "Authenticated users can update campaign_rules"
  ON campaign_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete campaign_rules" ON campaign_rules;
CREATE POLICY "Authenticated users can delete campaign_rules"
  ON campaign_rules FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 8. state_places (lookup: places per state)
-- =============================================================================
ALTER TABLE state_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view state_places" ON state_places;
CREATE POLICY "Authenticated users can view state_places"
  ON state_places FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert state_places" ON state_places;
CREATE POLICY "Authenticated users can insert state_places"
  ON state_places FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update state_places" ON state_places;
CREATE POLICY "Authenticated users can update state_places"
  ON state_places FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete state_places" ON state_places;
CREATE POLICY "Authenticated users can delete state_places"
  ON state_places FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 9. user_roles (user_id -> role mapping for permissions)
-- =============================================================================
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view user_roles" ON user_roles;
CREATE POLICY "Authenticated users can view user_roles"
  ON user_roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert user_roles" ON user_roles;
CREATE POLICY "Authenticated users can insert user_roles"
  ON user_roles FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update user_roles" ON user_roles;
CREATE POLICY "Authenticated users can update user_roles"
  ON user_roles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete user_roles" ON user_roles;
CREATE POLICY "Authenticated users can delete user_roles"
  ON user_roles FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 10. state_refresh_settings (per-state weekly refresh mode)
-- =============================================================================
ALTER TABLE state_refresh_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view state_refresh_settings" ON state_refresh_settings;
CREATE POLICY "Authenticated users can view state_refresh_settings"
  ON state_refresh_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert state_refresh_settings" ON state_refresh_settings;
CREATE POLICY "Authenticated users can insert state_refresh_settings"
  ON state_refresh_settings FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update state_refresh_settings" ON state_refresh_settings;
CREATE POLICY "Authenticated users can update state_refresh_settings"
  ON state_refresh_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete state_refresh_settings" ON state_refresh_settings;
CREATE POLICY "Authenticated users can delete state_refresh_settings"
  ON state_refresh_settings FOR DELETE TO authenticated USING (true);
