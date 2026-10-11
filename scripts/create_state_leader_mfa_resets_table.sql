-- Audit trail of admin "Reset 2FA" actions (app/api/admin/reset-mfa →
-- lib/services/mfaResetService.ts). Append-only; the service role writes it
-- (bypasses RLS), admins can read it. The reset itself works without this
-- table — the audit insert is best-effort — but run this so resets are recorded.
CREATE TABLE IF NOT EXISTS public.state_leader_mfa_resets (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state_leader_id  UUID        NOT NULL,
  target_user_id   UUID        NOT NULL,
  reset_by         TEXT        NOT NULL,   -- "Leader (STATE)" of the admin who did it
  reset_by_user_id UUID        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.state_leader_mfa_resets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "state_leader_mfa_resets: admin can read" ON public.state_leader_mfa_resets;
CREATE POLICY "state_leader_mfa_resets: admin can read"
  ON public.state_leader_mfa_resets FOR SELECT TO authenticated
  USING (public.is_admin());

-- No INSERT/UPDATE/DELETE policies: only the service role writes.
