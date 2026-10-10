'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { emailConfirmSupabase } from '@/lib/emailConfirmSupabaseClient';
import { CodeEntryScreen, bodyTextClass } from '@/components/auth/CodeEntryScreen';

// Bounds how long the real-identity session (proven via the magic link) can
// sit idle mid-enrollment before it's discarded — this session's only job
// is to enroll a factor, never to persist, and state_leaders' RLS grants
// any authenticated session read access to every leader's row, so an
// abandoned tab on a shared device shouldn't stay usable indefinitely.
export const MFA_ABANDON_AFTER_MS = 5 * 60 * 1000;
// The main app and the /registry portal share the same underlying Supabase
// Auth user pool (same project) — a leader who also has /registry access
// under the same email could already have a verified TOTP factor there.
// Supabase's factor-name uniqueness applies regardless of the existing
// factor's own verification status, and both this app and /registry's own
// enroll page otherwise default to the same blank friendly_name — so an
// explicit, distinct name here is required, not just a good idea, to avoid
// colliding with a factor enrolled through a completely different flow
// (confirmed live, 2026-09-26: a leader with an existing /registry TOTP
// factor got a "friendly name \"\" already exists" error here).
const TOTP_FRIENDLY_NAME = 'AFJ Campaign App (Authenticator)';

export type MfaEnrollmentOutcome = 'success' | 'cancelled' | 'expired';
type Screen = 'checking' | 'step-up' | 'totp';

/**
 * The authenticator-app enrollment steps shared by /setup-mfa (reached via
 * its own magic link) and /confirm-email (which already holds a verified
 * session at the moment the email is confirmed, so it can offer enrollment
 * straight away instead of sending a second email). Expects
 * emailConfirmSupabase to already hold a signed-in session whose access
 * token is passed in. Always signs that session out before reporting a
 * terminal outcome, and owns the abandonment timer — the caller just
 * decides what to show for each outcome.
 */
export function MfaEnrollmentFlow({
  accessToken,
  onDone,
}: {
  accessToken: string;
  onDone: (outcome: MfaEnrollmentOutcome) => void;
}) {
  const [screen, setScreen] = useState<Screen>('checking');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const abandonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  const [totpFactorId, setTotpFactorId] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const [stepUpFactorId, setStepUpFactorId] = useState<string | null>(null);
  const [stepUpCode, setStepUpCode] = useState('');

  function clearAbandonTimer() {
    if (abandonTimerRef.current) {
      clearTimeout(abandonTimerRef.current);
      abandonTimerRef.current = null;
    }
  }

  function armAbandonTimer() {
    clearAbandonTimer();
    abandonTimerRef.current = setTimeout(async () => {
      await emailConfirmSupabase.auth.signOut();
      onDoneRef.current('expired');
    }, MFA_ABANDON_AFTER_MS);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // This app and /registry share one Supabase Auth user pool. If this
      // account already has ANY verified factor (from /registry, or a prior
      // enrollment here), Supabase requires the session to already be at
      // AAL2 before it will allow enrolling a new one at all — regardless of
      // friendlyName. nextLevel === 'aal2' with currentLevel !== 'aal2' means
      // "has a verified factor, hasn't proven it this session yet." Confirmed
      // live, 2026-09-26 (a bare enroll() call failed with "AAL2 required to
      // enroll a new factor"). Once that challenge succeeds, enrollment is
      // already satisfied — it's the same underlying Supabase Auth account,
      // so a second, app-specific TOTP factor would just be a duplicate
      // (Peter reported being asked to scan a brand new QR code right after
      // proving he already had one — confirmed live, 2026-09-26).
      const { data: aalData } = await emailConfirmSupabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;
      if (aalData && aalData.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
        const { data: factorsData } = await emailConfirmSupabase.auth.mfa.listFactors();
        if (cancelled) return;
        const existing = factorsData?.all.find((f) => f.status === 'verified');
        if (existing) {
          setStepUpFactorId(existing.id);
          setScreen('step-up');
          armAbandonTimer();
          return;
        }
      }

      // Authenticator app (TOTP) only — Peter's call, 2026-09-27: no SMS
      // choice, so there's nothing to choose between.
      setScreen('totp');
      armAbandonTimer();
    })();

    return () => {
      cancelled = true;
      clearAbandonTimer();
    };
  }, []);

  // Stale-factor cleanup — Supabase rejects a second enroll() with a 422
  // "factor name conflict" once one unverified TOTP factor already exists
  // (both default to the same empty friendly_name).
  async function unenrollStaleTotpFactors(): Promise<string | null> {
    const { data, error: listError } = await emailConfirmSupabase.auth.mfa.listFactors();
    if (listError) return listError.message;
    const stale = data.all.filter((f) => f.factor_type === 'totp' && f.status !== 'verified');
    await Promise.all(stale.map((f) => emailConfirmSupabase.auth.mfa.unenroll({ factorId: f.id })));
    return null;
  }

  // TOTP enrollment — triggered on entering the totp screen, mirroring
  // app/registry/mfa/enroll/page.tsx's exact mechanics.
  useEffect(() => {
    if (screen !== 'totp' || totpFactorId) return;

    let cancelled = false;

    (async () => {
      const cleanupError = await unenrollStaleTotpFactors();
      if (cancelled) return;
      if (cleanupError) {
        setError(cleanupError);
        return;
      }

      const { data, error: enrollError } = await emailConfirmSupabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: TOTP_FRIENDLY_NAME });
      if (cancelled) return;
      if (enrollError) {
        setError(enrollError.message);
        return;
      }
      setTotpFactorId(data.id);
      // data.totp.uri (not data.totp.qr_code, a hugely bloated SVG) — see
      // the registry enroll page's identical comment for why.
      setTotpUri(data.totp.uri);
      setTotpSecret(data.totp.secret);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, totpFactorId]);

  async function finishEnrollment() {
    clearAbandonTimer();
    try {
      const res = await fetch('/api/auth/complete-mfa-setup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        console.error('complete-mfa-setup failed:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.error('complete-mfa-setup request failed:', err);
    } finally {
      await emailConfirmSupabase.auth.signOut();
      onDoneRef.current('success');
    }
  }

  async function handleStepUpVerify() {
    if (!stepUpFactorId) return;
    setIsBusy(true);
    setError(null);
    const { error: verifyError } = await emailConfirmSupabase.auth.mfa.challengeAndVerify({ factorId: stepUpFactorId, code: stepUpCode });
    setIsBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    // The existing verified factor already satisfies MFA for this account —
    // no separate app-specific factor needed (see the AAL2 comment above).
    await finishEnrollment();
  }

  async function handleVerifyTotp() {
    if (!totpFactorId) return;
    setIsBusy(true);
    setError(null);
    const { error: verifyError } = await emailConfirmSupabase.auth.mfa.challengeAndVerify({ factorId: totpFactorId, code: totpCode });
    setIsBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    await finishEnrollment();
  }

  // Shared by both the step-up screen's Cancel and the totp screen's — there's
  // only one enrollment method now, so "back" out of it just means
  // abandoning setup for another time.
  async function handleCancel() {
    clearAbandonTimer();
    await emailConfirmSupabase.auth.signOut();
    onDoneRef.current('cancelled');
  }

  if (screen === 'checking') {
    return <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Getting ready…</h2>;
  }

  if (screen === 'step-up') {
    return (
      <CodeEntryScreen
        title="Verify your identity"
        description="This account already has two-factor authentication set up elsewhere (e.g. the AFJ Registry portal). Enter a code from your existing authenticator app to finish setup here — no need to set up a separate one."
        code={stepUpCode}
        onCodeChange={setStepUpCode}
        onVerify={handleStepUpVerify}
        onBack={handleCancel}
        backLabel="Cancel"
        error={error}
        isBusy={isBusy}
        disabled={!stepUpFactorId}
      />
    );
  }

  return (
    <CodeEntryScreen
      title="Authenticator app"
      description="Scan the code below with an authenticator app (e.g. Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows."
      code={totpCode}
      onCodeChange={setTotpCode}
      onVerify={handleVerifyTotp}
      onBack={handleCancel}
      backLabel="Cancel"
      error={error}
      isBusy={isBusy}
      disabled={!totpFactorId}
    >
      {totpUri && (
        <div className="mx-auto w-fit rounded-md border-2 border-gray-800 bg-white p-4 dark:border-gray-600">
          <QRCode value={totpUri} size={200} />
        </div>
      )}
      {totpSecret && (
        <p className={bodyTextClass}>
          Can&apos;t scan it? Enter this key manually:<br />
          <code className="mt-1 inline-block rounded bg-gray-200 px-2 py-1 text-gray-900 dark:bg-gray-800 dark:text-gray-100">{totpSecret}</code>
        </p>
      )}
    </CodeEntryScreen>
  );
}
