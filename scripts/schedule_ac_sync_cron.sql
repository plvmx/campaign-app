-- Schedules the ac-sync Edge Function via pg_cron + pg_net.
-- See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
-- Section 6 ("start daily; revisit frequency if latency proves an issue" —
-- plan Section 6.3 / brief build order step 3).
--
-- Increased from once daily to every 6 hours 2026-09-13 per Peter's
-- request, so a new AC registration shows up in /registry/manage within
-- hours rather than up to a full day — see OPERATIONS.md's "Cron
-- frequency increased to every 6 hours" entry for the full rationale
-- (why 6 hours specifically, and why it doesn't strain AC's rate limit or
-- the Edge Function's execution budget). The job name stays
-- `ac-sync-daily` even though it's no longer literally daily — same
-- precedent as the earlier temporary catch-up speed-ups (OPERATIONS.md's
-- 2026-09-09 entries): calling `cron.schedule` again with the same job
-- name updates the existing job's schedule in place (same `jobid`), so
-- `cron.job_run_details` history and any saved monitoring queries by name
-- keep working across this change.
--
-- Prerequisites (one-time, do in this order):
--   1. Deploy the function: `supabase functions deploy ac-sync`
--   2. Set its secrets: `supabase secrets set AC_API_BASE_URL=... AC_API_KEY=...`
--      (never put these in a SQL script or commit them — plan Section 3.2)
--   3. Store a bearer secret for pg_net to call the function with, in
--      Supabase Vault (Dashboard -> Project Settings -> Vault, or via SQL:
--      `select vault.create_secret('<service-role-or-dedicated-key>', 'ac_sync_bearer_token');`)
--      so the literal key never appears in this committed script.
--   4. The URL below is already filled in with this project's ref
--      (vzyoxmfjlwbfqrwiirld) — no edit needed.
--
-- Run this in the Supabase SQL Editor after the above (or, if the job is
-- already scheduled and you're just changing its frequency, run just the
-- `cron.schedule(...)` call below — the two `CREATE EXTENSION` lines are
-- idempotent either way).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'ac-sync-daily',
  '0 */6 * * *', -- every 6 hours, on the hour (00:00/06:00/12:00/18:00 UTC)
  $$
  SELECT net.http_post(
    url := 'https://vzyoxmfjlwbfqrwiirld.supabase.co/functions/v1/ac-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ac_sync_bearer_token'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check the job is registered: select * from cron.job where jobname = 'ac-sync-daily';
-- To see run history/latency:      select d.* from cron.job_run_details d
--                                     join cron.job j on j.jobid = d.jobid
--                                     where j.jobname = 'ac-sync-daily' order by d.start_time desc limit 20;
-- To unschedule:                   select cron.unschedule('ac-sync-daily');
