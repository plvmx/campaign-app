'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'react-qr-code';
import { emailConfirmSupabase } from '@/lib/emailConfirmSupabaseClient';

const GIVE_UP_AFTER_MS = 8000;
// Bounds how long the real-identity session (proven via the magic link) can
// sit idle mid-enrollment before it's discarded — this session's only job
// is to enroll a factor, never to persist, and state_leaders' RLS grants
// any authenticated session read access to every leader's row, so an
// abandoned tab on a shared device shouldn't stay usable indefinitely.
const ABANDON_AFTER_MS = 5 * 60 * 1000;
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

type Screen = 'waiting' | 'expired' | 'cancelled' | 'step-up' | 'totp' | 'success';

const inputClass =
  'mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300';
const primaryButtonClass =
  'w-full rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600';
const secondaryButtonClass =
  'w-full text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50';
const errorBannerClass = 'rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200';
const bodyTextClass = 'text-center text-sm text-gray-600 dark:text-gray-400';
const cardClass =
  'w-full max-w-md space-y-4 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-blue-50 p-6 shadow-lg dark:bg-blue-900/20 sm:p-8';

function CodeEntryScreen({
  title, description, children, code, onCodeChange, onVerify, onBack, backLabel = '← Back', error, isBusy, disabled,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  code: string;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onBack: () => void;
  backLabel?: string;
  error: string | null;
  isBusy: boolean;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
      <p className={bodyTextClass}>{description}</p>
      {children}
      <div>
        <label htmlFor="mfa-code" className={labelClass}>6-digit code</label>
        <input
          id="mfa-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          className={inputClass}
        />
      </div>
      {error && <p role="alert" className={errorBannerClass}>{error}</p>}
      <button onClick={onVerify} disabled={isBusy || disabled || code.length < 6} className={primaryButtonClass}>
        {isBusy ? 'Verifying…' : 'Verify and continue'}
      </button>
      <button onClick={onBack} disabled={isBusy} className={secondaryButtonClass}>{backLabel}</button>
    </div>
  );
}

/**
 * MFA enrollment landing page for the leader self-serve flow (see
 * app/api/auth/request-mfa-setup/route.ts and
 * app/api/auth/complete-mfa-setup/route.ts). Reuses
 * lib/emailConfirmSupabaseClient.ts (shared with app/confirm-email/page.tsx)
 * for the same reason that page does: an isolated session to prove identity
 * via magic link. Unlike /confirm-email, this session has to stay alive
 * through a multi-step enrollment UI rather than being signed out
 * immediately — ABANDON_AFTER_MS bounds how long that window can stay open.
 */
export default function SetupMfaPage() {
  const [screen, setScreen] = useState<Screen>('waiting');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const handledRef = useRef(false);
  const abandonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setScreen('expired');
    }, ABANDON_AFTER_MS);
  }

  // Sign-in wait — identical pattern to app/confirm-email/page.tsx.
  useEffect(() => {
    async function handleSignedIn(session: { access_token: string; user: { id: string } }) {
      if (handledRef.current) return;
      handledRef.current = true;
      setAccessToken(session.access_token);

      // This app and /registry share one Supabase Auth user pool. If this
      // account already has ANY verified factor (from /registry, or a prior
      // enrollment here), Supabase requires the session to already be at
      // AAL2 before it will allow enrolling a new one at all — regardless of
      // friendlyName. nextLevel === 'aal2' with currentLevel !== 'aal2' means
      // "has a verified factor, hasn't proven it this session yet." Confirmed
      // live, 2026-09-26 (a bare enroll() call failed with "AAL2 required to
      // enroll a new factor"). Once that challenge succeeds, enrollment is
      // already satisfied — it's the same underlying Supabase Auth account,
      // so a second, app-specific TOTP factor would just be a duplicate.
      // (The step-up screen originally continued on to enroll a fresh factor
      // regardless; Peter reported this as confusing — being asked to scan a
      // brand new QR code right after proving he already had one set up —
      // confirmed live, 2026-09-26, fixed same day.)
      const { data: aalData } = await emailConfirmSupabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData && aalData.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
        const { data: factorsData } = await emailConfirmSupabase.auth.mfa.listFactors();
        const existing = factorsData?.all.find((f) => f.status === 'verified');
        if (existing) {
          setStepUpFactorId(existing.id);
          setScreen('step-up');
          armAbandonTimer();
          return;
        }
      }

      // Authenticator app (TOTP) only — Peter's call, 2026-09-27: no SMS
      // choice, so there's nothing to choose between and this goes straight
      // to enrollment.
      setScreen('totp');
      armAbandonTimer();
    }

    const { data: { subscription } } = emailConfirmSupabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) handleSignedIn(session);
    });

    emailConfirmSupabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleSignedIn(session);
    });

    const giveUp = setTimeout(() => {
      if (!handledRef.current) setScreen('expired');
    }, GIVE_UP_AFTER_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(giveUp);
      clearAbandonTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (accessToken) {
        const res = await fetch('/api/auth/complete-mfa-setup', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          console.error('complete-mfa-setup failed:', res.status, await res.text().catch(() => ''));
        }
      }
    } catch (err) {
      console.error('complete-mfa-setup request failed:', err);
    } finally {
      await emailConfirmSupabase.auth.signOut();
      setScreen('success');
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
    // no separate app-specific factor needed. See the comment on the AAL2
    // check above for why continuing on to enroll a fresh one (as this
    // originally did) was wrong.
    await finishEnrollment();
  }

  // Shared by both the step-up screen's Cancel and the totp screen's Back —
  // there's only one enrollment method now, so "back" out of it just means
  // abandoning setup for another time, same as cancelling step-up.
  async function handleCancel() {
    clearAbandonTimer();
    await emailConfirmSupabase.auth.signOut();
    setScreen('cancelled');
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

  if (screen === 'waiting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Signing you in…</h2>
        </div>
      </div>
    );
  }

  if (screen === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Link expired</h2>
          <p className={bodyTextClass}>This confirmation link is invalid or has expired.</p>
          <a href="/login" className={`${primaryButtonClass} block text-center`}>Back to sign in</a>
        </div>
      </div>
    );
  }

  if (screen === 'cancelled') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">No problem</h2>
          <p className={bodyTextClass}>You can set up two-factor authentication another time.</p>
          <a href="/login" className={`${primaryButtonClass} block text-center`}>Back to sign in</a>
        </div>
      </div>
    );
  }

  if (screen === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Two-factor authentication is set up</h2>
          <p className={bodyTextClass}>You&apos;re all set — no further action needed today.</p>
          <a href="/app" className={`${primaryButtonClass} block text-center`}>Continue</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className={cardClass}>
        {screen === 'step-up' && (
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
        )}

        {screen === 'totp' && (
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
        )}
      </div>
    </div>
  );
}
