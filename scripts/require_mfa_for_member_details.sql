-- Members' personal details (names, mobile numbers, emails of people who registered
-- interest) can only be read or updated by a session that has passed 2FA.
--
-- Until now an owning/shared leader (or admin) could read campaign_interest and
-- training_interest rows with just a mobile+name sign-in. This adds
-- (auth.jwt() ->> 'aal') = 'aal2' to the SELECT and UPDATE policies on both tables
-- — 'aal2' means the session completed an authenticator-app challenge. The service
-- role (public registration, "text the leader" SMS, the counts route) bypasses RLS
-- and is unaffected.
--
-- Leaders still see HOW MANY people registered (app/api/leader/interest-counts —
-- numbers only), so they know when they need to set 2FA up.
--
-- RUN ONLY AFTER the matching app code is deployed: until the app uses the counts
-- route, the "N people interested" note and the "Manage my Campaign Interest"
-- button would read zero for leaders who haven't passed 2FA.
--
-- The visibility rules are copied unchanged from supabase/rls-policies.sql; only the
-- aal2 condition is new. To roll back, re-run those policies from that file.

BEGIN;

DROP POLICY IF EXISTS "campaign_interest: owner or shared leader or admin can read" ON campaign_interest;
CREATE POLICY "campaign_interest: owner or shared leader or admin can read"
  ON campaign_interest FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'aal') = 'aal2'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM campaigns c
        JOIN user_profiles up ON up.user_id = auth.uid()
        WHERE c.id = campaign_interest.campaign_id
          AND up.state = c.state
          AND lower(trim(up.name)) = lower(trim(c.leader))
      )
      OR EXISTS (
        SELECT 1 FROM campaigns c
        JOIN leader_shares ls ON ls.owner_state = c.state
          AND lower(trim(ls.owner_leader)) = lower(trim(c.leader))
        JOIN user_profiles up ON up.user_id = auth.uid()
          AND ls.shared_with_state = up.state
          AND lower(trim(ls.shared_with_leader)) = lower(trim(up.name))
        WHERE c.id = campaign_interest.campaign_id
      )
    )
  );

DROP POLICY IF EXISTS "campaign_interest: owner or shared leader or admin can update" ON campaign_interest;
CREATE POLICY "campaign_interest: owner or shared leader or admin can update"
  ON campaign_interest FOR UPDATE TO authenticated
  USING (
    (auth.jwt() ->> 'aal') = 'aal2'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM campaigns c
        JOIN user_profiles up ON up.user_id = auth.uid()
        WHERE c.id = campaign_interest.campaign_id
          AND up.state = c.state
          AND lower(trim(up.name)) = lower(trim(c.leader))
      )
      OR EXISTS (
        SELECT 1 FROM campaigns c
        JOIN leader_shares ls ON ls.owner_state = c.state
          AND lower(trim(ls.owner_leader)) = lower(trim(c.leader))
        JOIN user_profiles up ON up.user_id = auth.uid()
          AND ls.shared_with_state = up.state
          AND lower(trim(ls.shared_with_leader)) = lower(trim(up.name))
        WHERE c.id = campaign_interest.campaign_id
      )
    )
  );

DROP POLICY IF EXISTS "training_interest: owner or shared leader or admin can read" ON training_interest;
CREATE POLICY "training_interest: owner or shared leader or admin can read"
  ON training_interest FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'aal') = 'aal2'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM campaigns c
        JOIN user_profiles up ON up.user_id = auth.uid()
        WHERE c.id = training_interest.campaign_id
          AND up.state = c.state
          AND lower(trim(up.name)) = lower(trim(c.leader))
      )
      OR EXISTS (
        SELECT 1 FROM campaigns c
        JOIN leader_shares ls ON ls.owner_state = c.state
          AND lower(trim(ls.owner_leader)) = lower(trim(c.leader))
        JOIN user_profiles up ON up.user_id = auth.uid()
          AND ls.shared_with_state = up.state
          AND lower(trim(ls.shared_with_leader)) = lower(trim(up.name))
        WHERE c.id = training_interest.campaign_id
      )
    )
  );

DROP POLICY IF EXISTS "training_interest: owner or shared leader or admin can update" ON training_interest;
CREATE POLICY "training_interest: owner or shared leader or admin can update"
  ON training_interest FOR UPDATE TO authenticated
  USING (
    (auth.jwt() ->> 'aal') = 'aal2'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM campaigns c
        JOIN user_profiles up ON up.user_id = auth.uid()
        WHERE c.id = training_interest.campaign_id
          AND up.state = c.state
          AND lower(trim(up.name)) = lower(trim(c.leader))
      )
      OR EXISTS (
        SELECT 1 FROM campaigns c
        JOIN leader_shares ls ON ls.owner_state = c.state
          AND lower(trim(ls.owner_leader)) = lower(trim(c.leader))
        JOIN user_profiles up ON up.user_id = auth.uid()
          AND ls.shared_with_state = up.state
          AND lower(trim(ls.shared_with_leader)) = lower(trim(up.name))
        WHERE c.id = training_interest.campaign_id
      )
    )
  );

COMMIT;
