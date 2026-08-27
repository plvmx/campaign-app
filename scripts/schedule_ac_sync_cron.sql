-- Schedules the ac-sync Edge Function to run daily via pg_cron + pg_net.
-- See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
-- Section 6 ("start daily; revisit frequency if latency proves an issue" —
-- plan Section 6.3 / brief build order step 3).
--
-- Prerequisites (one-time, do in this order):
--   1. Deploy the function: `supabase functions deploy ac-sync`
--   2. Set its secrets: `supabase secrets set AC_API_BASE_URL=... AC_API_KEY=...`
--      (never put these in a SQL script or commit them — plan Section 3.2)
--   3. Store a bearer secret for pg_net to call the function with, in
--      Supabase Vault (Dashboard -> Project Settings -> Vault, or via SQL:
--      `select vault.create_secret('<service-role-or-dedicated-key>', 'ac_sync_bearer_token');`)
--      so the literal key never appears in this committed script.
--   4. Replace <PROJECT_REF> below with this project's ref before running.
--
-- Run this in the Supabase SQL Editor after the above.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'ac-sync-daily',
  '0 15 * * *', -- 15:00 UTC daily (~01:00 AEST / 02:00 AEDT) — adjust if a different window suits AFJ better
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ac-sync',
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
