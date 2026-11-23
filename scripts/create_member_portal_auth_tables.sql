-- Member portal sign-in (docs/member-portal/SIGN_IN_DESIGN.md, Phase 2 step 1).
--
-- Registrants are NOT Supabase Auth users. Their sign-in lives entirely in
-- these four tables, which only the service role (API routes under
-- /api/member/*) can touch — RLS is enabled with no policies (default-deny)
-- and anon/authenticated are explicitly revoked, same pattern as the other
-- registry tables.
--
-- Credentials (invite tokens, one-time codes, session ids) are stored only as
-- hashes. IP addresses are stored only as a keyed hash.
--
-- Ids: BIGINT GENERATED ALWAYS AS IDENTITY (never BIGSERIAL — see
-- fix_whatsapp_invite_log_sequence_grant.sql for the incident), except
-- member_verifications, whose id is handed to the browser and so is a random
-- UUID rather than a guessable counter.
--
-- Run in the Supabase SQL Editor (idempotent). Safe to run before the code is
-- deployed — nothing reads these tables until the /api/member/* routes exist.

-- One opaque link per registrant (the customised sign-in link). Opening the
-- link proves nothing; it only tells the page which registrant to show.
CREATE TABLE IF NOT EXISTS registry.member_invites (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registrant_id  UUID NOT NULL REFERENCES registry.registrants(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS member_invites_registrant_idx ON registry.member_invites (registrant_id);

-- One sign-in attempt: a pair of codes (email + text message).
CREATE TABLE IF NOT EXISTS registry.member_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registrant_id   UUID NOT NULL REFERENCES registry.registrants(id) ON DELETE CASCADE,
  invite_id       BIGINT REFERENCES registry.member_invites(id) ON DELETE SET NULL,
  email_code_hash TEXT NOT NULL,
  sms_code_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  consumed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS member_verifications_registrant_idx ON registry.member_verifications (registrant_id);

-- A signed-in device. The cookie carries the raw id; only its hash is stored.
CREATE TABLE IF NOT EXISTS registry.member_sessions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registrant_id  UUID NOT NULL REFERENCES registry.registrants(id) ON DELETE CASCADE,
  session_hash   TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  device_label   TEXT
);
CREATE INDEX IF NOT EXISTS member_sessions_registrant_idx ON registry.member_sessions (registrant_id);

-- Append-only audit trail AND the source of the send/verify throttles (the
-- app's in-memory rate limiter resets on cold starts, which is not enough to
-- cap SMS spend). Never holds a code.
CREATE TABLE IF NOT EXISTS registry.member_auth_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registrant_id UUID REFERENCES registry.registrants(id) ON DELETE SET NULL,
  event         TEXT NOT NULL CHECK (event IN (
                  'codes_sent', 'email_failed', 'sms_failed', 'ineligible', 'throttled',
                  'verify_ok', 'verify_bad', 'verify_locked', 'session_revoked')),
  ip_hash       TEXT,
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_auth_events_registrant_idx ON registry.member_auth_events (registrant_id, event, created_at DESC);
CREATE INDEX IF NOT EXISTS member_auth_events_ip_idx ON registry.member_auth_events (ip_hash, event, created_at DESC);
CREATE INDEX IF NOT EXISTS member_auth_events_event_idx ON registry.member_auth_events (event, created_at DESC);

-- Default-deny: RLS on, no policies, nothing for anon/authenticated.
ALTER TABLE registry.member_invites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry.member_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry.member_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry.member_auth_events   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON registry.member_invites       FROM anon, authenticated;
REVOKE ALL ON registry.member_verifications FROM anon, authenticated;
REVOKE ALL ON registry.member_sessions      FROM anon, authenticated;
REVOKE ALL ON registry.member_auth_events   FROM anon, authenticated;

GRANT ALL ON registry.member_invites       TO service_role;
GRANT ALL ON registry.member_verifications TO service_role;
GRANT ALL ON registry.member_sessions      TO service_role;
GRANT ALL ON registry.member_auth_events   TO service_role;
