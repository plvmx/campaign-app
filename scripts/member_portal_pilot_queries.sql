-- Member portal sign-in — pilot monitoring and tidy-up queries
-- (docs/member-portal/SIGN_IN_DESIGN.md; TECHNICAL_DOCS.md §18.6).
--
-- Run these by hand in the Supabase SQL Editor, one block at a time. Everything in
-- sections 1–3 is READ-ONLY. Section 4 changes data — read the comment above each
-- statement first. Nothing here ever shows a code (none is stored, only hashes).
--
-- member_auth_events.event values:
--   codes_sent      both messages went out          email_failed / sms_failed  a provider rejected one
--   ineligible      no match / can't self-serve     throttled                  a send limit was hit (detail = which)
--   verify_ok       signed in                       verify_bad                 a wrong or reused code
--   verify_locked   5th wrong try on one pair       session_revoked            signed out of all devices


-- ============================================================================
-- 1. Is it working? (last 24 hours — change the interval as needed)
-- ============================================================================

-- 1a. What happened, by type.
SELECT event, count(*) AS n
FROM registry.member_auth_events
WHERE created_at > now() - interval '24 hours'
GROUP BY event
ORDER BY n DESC;

-- 1b. Sign-in funnel: of the people sent codes, how many got in?
SELECT
  count(DISTINCT registrant_id) FILTER (WHERE event = 'codes_sent') AS people_sent_codes,
  count(DISTINCT registrant_id) FILTER (WHERE event = 'verify_ok')  AS people_signed_in,
  count(*) FILTER (WHERE event = 'codes_sent')                      AS sends,
  count(*) FILTER (WHERE event = 'verify_ok')                       AS sign_ins
FROM registry.member_auth_events
WHERE created_at > now() - interval '24 hours';

-- 1c. Anything that FAILED to send — each of these is a bug or a bad number to chase.
SELECT e.created_at, e.event, e.detail, r.first_name, r.email, r.phone
FROM registry.member_auth_events e
LEFT JOIN registry.registrants r ON r.id = e.registrant_id
WHERE e.event IN ('email_failed', 'sms_failed')
ORDER BY e.created_at DESC
LIMIT 50;

-- 1d. Texts sent today vs the daily ceiling (the app_settings row, else the built-in 1500).
SELECT
  (SELECT count(*) FROM registry.member_auth_events WHERE event = 'codes_sent' AND created_at > now() - interval '24 hours') AS texts_last_24h,
  coalesce((SELECT setting_value FROM public.app_settings WHERE setting_key = 'member_sms_daily_ceiling'), '1500 (default)') AS ceiling;


-- ============================================================================
-- 2. Who is stuck?
-- ============================================================================

-- 2a. People sent codes in the last 7 days who have NOT signed in since.
SELECT r.first_name, r.email, r.phone, max(e.created_at) AS last_sent,
       count(*) AS sends
FROM registry.member_auth_events e
JOIN registry.registrants r ON r.id = e.registrant_id
WHERE e.event = 'codes_sent' AND e.created_at > now() - interval '7 days'
  AND NOT EXISTS (
    SELECT 1 FROM registry.member_auth_events ok
    WHERE ok.registrant_id = e.registrant_id AND ok.event = 'verify_ok' AND ok.created_at > e.created_at
  )
GROUP BY r.first_name, r.email, r.phone
ORDER BY last_sent DESC;

-- 2b. Locked-out or throttled attempts (and which limit).
SELECT created_at, event, detail, registrant_id
FROM registry.member_auth_events
WHERE event IN ('verify_locked', 'throttled') AND created_at > now() - interval '7 days'
ORDER BY created_at DESC
LIMIT 100;

-- 2c. One person's full history (replace the address).
SELECT e.created_at, e.event, e.detail
FROM registry.member_auth_events e
JOIN registry.registrants r ON r.id = e.registrant_id
WHERE r.email = lower('someone@example.com')
ORDER BY e.created_at;


-- ============================================================================
-- 3. Links and sessions
-- ============================================================================

-- 3a. Links created, opened, and still live.
SELECT r.first_name, r.email, i.created_at, i.expires_at, i.last_opened_at,
       (i.revoked_at IS NOT NULL) AS revoked
FROM registry.member_invites i
JOIN registry.registrants r ON r.id = i.registrant_id
ORDER BY i.created_at DESC
LIMIT 100;

-- 3b. Signed-in devices right now.
SELECT r.first_name, r.email, s.created_at, s.last_seen_at, s.expires_at, s.device_label
FROM registry.member_sessions s
JOIN registry.registrants r ON r.id = s.registrant_id
WHERE s.revoked_at IS NULL AND s.expires_at > now()
ORDER BY s.last_seen_at DESC;


-- ============================================================================
-- 4. Tidy-up / rollback (CHANGES DATA — run only the statement you mean to)
-- ============================================================================

-- 4a. Lower (or set) the daily text ceiling for the pilot. Safe to re-run.
INSERT INTO public.app_settings (setting_key, setting_value, description)
VALUES ('member_sms_daily_ceiling', '40', 'Most member sign-in text messages sent per 24 hours (pilot safety limit)')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();
-- The app caches this value for about a minute.

-- 4b. Revoke every live link (people can no longer open them; nothing else changes).
-- UPDATE registry.member_invites SET revoked_at = now() WHERE revoked_at IS NULL;

-- 4c. Sign every member out on every device.
-- UPDATE registry.member_sessions SET revoked_at = now() WHERE revoked_at IS NULL;

-- 4d. Retire any codes still waiting to be typed in.
-- UPDATE registry.member_verifications SET consumed_at = now() WHERE consumed_at IS NULL;

-- 4e. After the pilot: clear the audit rows (this also resets the send limits).
-- DELETE FROM registry.member_auth_events WHERE created_at < now() - interval '0 minutes';
