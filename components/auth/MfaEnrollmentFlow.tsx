'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { emailConfirmSupabase } from '@/lib/emailConfirmSupabaseClient';
import { describeMfaVerifyError } from '@/lib/mfaErrors';
import { clearPendingTotpEnrollment, readPendingTotpEnrollment, savePendingTotpEnrollment } from '@/lib/pendingTotpEnrollment';
import { CodeEntryScreen, bodyTextClass, primaryButtonClass, secondaryButtonClass } from '@/components/auth/CodeEntryScreen';
import { GetHelp } from '@/components/auth/GetHelp';
import { SetupStep } from '@/components/auth/SetupStep';
import { AUTHENTICATOR_STORE_LINKS } from '@/lib/authenticatorApps';

// Bounds how long the real-identity session (proven via the magic link) can
// sit idle mid-enrollment before it's discarded — this session's only job
// is to enroll a factor, never to persist, and state_leaders' RLS grants
// any authenticated session read access to every leader's row, so an
// abandoned tab on a shared device shouldn't stay usable indefinitely.
// 15 minutes, not 5: on a phone the person has to leave this page to add the key to
// their authenticator app and come back, and 5 minutes timed a leader out (2026-10-13).
export const MFA_ABANDON_AFTER_MS = 15 * 60 * 1000;
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
      clearPendingTotpEnrollment();
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
      // A reload (e.g. iPhone returning from the authenticator app) must show
      // the SAME key again: the person has already put it in their app, and a
      // fresh one would make every code they type fail (lib/pendingTotpEnrollment.ts).
      const saved = readPendingTotpEnrollment();
      if (saved) {
        const { data: existing } = await emailConfirmSupabase.auth.mfa.listFactors();
        if (cancelled) return;
        const stillThere = existing?.all.some(
          (f) => f.id === saved.factorId && f.factor_type === 'totp' && f.status === 'unverified',
        );
        if (stillThere) {
          setTotpFactorId(saved.factorId);
          setTotpUri(saved.uri);
          setTotpSecret(saved.secret);
          return;
        }
        clearPendingTotpEnrollment();
      }

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
      savePendingTotpEnrollment({ factorId: data.id, uri: data.totp.uri, secret: data.totp.secret });
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, totpFactorId]);

  async function finishEnrollment() {
    clearAbandonTimer();
    clearPendingTotpEnrollment();
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
      setError(describeMfaVerifyError(verifyError));
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
      setError(describeMfaVerifyError(verifyError));
      return;
    }
    await finishEnrollment();
  }

  // Shared by both the step-up screen's Cancel and the totp screen's — there's
  // only one enrollment method now, so "back" out of it just means
  // abandoning setup for another time.
  async function handleCancel() {
    clearAbandonTimer();
    clearPendingTotpEnrollment();
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
        help={<GetHelp step="proving my identity with my existing authenticator app" />}
      />
    );
  }

  return (
    <CodeEntryScreen
      title="Authenticator app"
      description="You need a free authenticator app on your phone — for example Google Authenticator or Microsoft Authenticator (install one from your phone's app store first if you don't have one). On this phone, tap the Add to my authenticator app button below; on a computer, scan the code with the app instead. Then type the 6-digit number the app shows. If you set up AFJ in your app on an earlier try, delete that old entry first — only the one from this page will work."
      code={totpCode}
      onCodeChange={setTotpCode}
      onVerify={handleVerifyTotp}
      onBack={handleCancel}
      backLabel="Cancel — I'll do this later"
      error={error}
      isBusy={isBusy}
      disabled={!totpFactorId}
      stepBadge={<SetupStep n={2} label="Set up your authenticator app" />}
      help={<GetHelp step="setting up my authenticator app" />}
    >
      <details className="rounded-md border-2 border-gray-300 p-3 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
        <summary className="cursor-pointer font-semibold">I don&apos;t have an authenticator app yet</summary>
        <p className="mt-2">Install one (free), then come back to this page:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {AUTHENTICATOR_STORE_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline dark:text-blue-300">{l.label}</a>
            </li>
          ))}
        </ul>
      </details>
      {totpUri && (
        <a href={totpUri} className={`${primaryButtonClass} block text-center`}>Add to my authenticator app</a>
      )}
      {totpUri && (
        <div className="mx-auto w-fit rounded-md border-2 border-gray-800 bg-white p-4 dark:border-gray-600">
          <QRCode value={totpUri} size={200} />
        </div>
      )}
      {totpSecret && (
        <div className="space-y-2">
          <p className={bodyTextClass}>
            Neither working? In the app choose &quot;enter a setup key&quot;, pick <strong>Time based</strong>, and use this key:<br />
            <code className="mt-1 inline-block break-all rounded bg-gray-200 px-2 py-1 text-gray-900 dark:bg-gray-800 dark:text-gray-100">{totpSecret}</code>
          </p>
          <CopyKeyButton secret={totpSecret} />
        </div>
      )}
    </CodeEntryScreen>
  );
}

/** Copies the setup key exactly (selecting text on a phone often grabs extra characters). */
function CopyKeyButton({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={handleCopy} className={secondaryButtonClass}>
      {copied ? 'Key copied' : 'Copy key'}
    </button>
  );
}
