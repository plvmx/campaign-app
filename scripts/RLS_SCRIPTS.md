# RLS (Row Level Security) Scripts

These scripts add or improve Row Level Security on Supabase tables to fix Security Advisor "RLS Disabled in Public" errors.

## `enable_rls_all_tables.sql` ⭐ **Run this first**

Enables RLS on all 10 tables reported by Supabase Security Advisor:

- `state_leaders`
- `results`
- `app_config` (or `app_settings` if app_config doesn't exist)
- `leader_shares`
- `campaign_changes_log`
- `weekly_refresh_log`
- `campaign_rules`
- `state_places`
- `user_roles`
- `state_refresh_settings`

All policies restrict access to `authenticated` users only. Fine-grained permissions (admin vs SR vs user) are enforced in application code.

**How to run**: Supabase Dashboard → SQL Editor → paste script → Run

## `add_campaigns_rls.sql`

Enables RLS on the `campaigns` table. Restricts access to authenticated users only. Fine-grained filtering (own campaigns, SR by state, admin all) is enforced in application code.

**Run when**: Campaigns table has no RLS (may already be fixed if you ran migrations).

## `improve_app_settings_rls.sql`

Updates `app_settings` policies to require authenticated users. Admin check remains in application code.

## `improve_campaign_messages_rls.sql`

Updates `campaign_messages` policies. All authenticated users can read; inserts/updates/deletes require authentication (admin check in app).

## `add_state_leaders_mobile_index.sql`

Adds an index on `state_leaders.mobile` for faster login validation lookups.

## `create_validate_leader_function.sql` ⭐ **Secure login (no anon access to state_leaders)**

Creates a PostgreSQL function `validate_leader_for_login(p_mobile, p_first_name)` with SECURITY DEFINER. It bypasses RLS, so the client can validate credentials without exposing `state_leaders` to anonymous users. The app calls this via `supabase.rpc()` instead of querying the table directly.

**Run first** before or after enable_rls_all_tables. Required for login to work with RLS enabled.

## `fix_state_leaders_login_rls.sql`

Removes the anon SELECT policy if you previously added it. With the RPC in place, anon access to `state_leaders` is no longer needed.

## Execution order

1. Run **`enable_rls_all_tables.sql`** to fix all Security Advisor RLS errors
2. Run **`create_validate_leader_function.sql`** for secure login (RPC bypasses RLS, no anon table access)
3. Run **`fix_state_leaders_login_rls.sql`** to remove anon policy if you added it previously
4. Run `add_campaigns_rls.sql` if campaigns table still has no RLS
5. Run `improve_app_settings_rls.sql` and `improve_campaign_messages_rls.sql` if needed
6. Run `add_state_leaders_mobile_index.sql` for performance
