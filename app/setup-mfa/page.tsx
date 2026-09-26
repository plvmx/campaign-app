'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'react-qr-code';
import { emailConfirmSupabase } from '@/lib/emailConfirmSupabaseClient';
import { toE164AuMobile } from '@/lib/services/campaignInterestSmsService';
import { isValidMobile } from '@/lib/validation';
import { getErrorMessage } from '@/lib/errorUtils';

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
const PHONE_FRIENDLY_NAME = 'AFJ Campaign App (SMS)';

type Screen = 'waiting' | 'expired' | 'choose-method' | 'totp' | 'phone-number' | 'phone-code' | 'success';
type FactorType = 'totp' | 'phone';

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

/** True for the "Phone provider not configured in this Supabase project" class of
 * error — approximate substring match, since no code path in this repo has ever
 * hit the real error shape yet (factorType: 'phone' is new territory here).
 * TODO: confirm the exact message/code once Phone MFA is dashboard-enabled. */
function isPhoneProviderUnavailableError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('phone') && (lower.includes('not enabled') || lower.includes('not configured') || lower.includes('disabled') || lower.includes('provider'));
}

/** Accepts either an already-E.164 number (light sanity check only) or the
 * app's usual local AU format, normalizing the latter via the same
 * isValidMobile/toE164AuMobile helpers every other phone-collecting form in
 * this app uses — the pre-fill already returns E.164, but a leader who edits
 * it back into local format (out of habit) shouldn't be sent straight to
 * Supabase's phone-factor enroll unvalidated. */
function normalizePhoneForMfa(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('+')) {
    return /^\+\d{8,15}$/.test(trimmed) ? trimmed : null;
  }
  return isValidMobile(trimmed) ? toE164AuMobile(trimmed) : null;
}

function CodeEntryScreen({
  title, description, children, code, onCodeChange, onVerify, onBack, error, isBusy, disabled,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  code: string;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onBack: () => void;
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
      <button onClick={onBack} disabled={isBusy} className={secondaryButtonClass}>← Back</button>
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
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const handledRef = useRef(false);
  const abandonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [totpFactorId, setTotpFactorId] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const [phone, setPhone] = useState('');
  const [phoneFactorId, setPhoneFactorId] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState('');

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
      setUserId(session.user.id);
      setScreen('choose-method');
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

  // Shared stale-factor cleanup — Supabase rejects a second enroll() with a
  // 422 "factor name conflict" once one unverified factor of that type
  // already exists (both default to the same empty friendly_name). Scoped
  // by factorType so cleaning up a stale TOTP attempt never touches an
  // in-progress phone one, or vice versa.
  async function unenrollStaleFactors(factorType: FactorType): Promise<string | null> {
    const { data, error: listError } = await emailConfirmSupabase.auth.mfa.listFactors();
    if (listError) return listError.message;
    const stale = data.all.filter((f) => f.factor_type === factorType && f.status !== 'verified');
    await Promise.all(stale.map((f) => emailConfirmSupabase.auth.mfa.unenroll({ factorId: f.id })));
    return null;
  }

  // TOTP enrollment — triggered on entering the totp screen, mirroring
  // app/registry/mfa/enroll/page.tsx's exact mechanics.
  useEffect(() => {
    if (screen !== 'totp' || totpFactorId) return;

    let cancelled = false;

    (async () => {
      const cleanupError = await unenrollStaleFactors('totp');
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

  async function choosePhoneMethod() {
    setError(null);
    setScreen('phone-number');
    if (phone || !userId) return;
    // Best-effort suggestion only — leave the field blank/editable if this
    // fails or finds nothing, never block on it. Deferred until the leader
    // actually picks this method, so the more common TOTP path never pays
    // for a query it doesn't use.
    try {
      const { data } = await emailConfirmSupabase
        .from('state_leaders')
        .select('mobile')
        .eq('user_id', userId)
        .not('mobile', 'is', null)
        .limit(1)
        .maybeSingle();
      const mobile = (data as { mobile: string | null } | null)?.mobile;
      if (mobile) {
        const e164 = toE164AuMobile(mobile);
        if (e164) setPhone(e164);
      }
    } catch {
      // ignore
    }
  }

  async function handleSendPhoneCode() {
    const normalized = normalizePhoneForMfa(phone);
    if (!normalized) {
      setError('Please enter a valid mobile number');
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const cleanupError = await unenrollStaleFactors('phone');
      if (cleanupError) throw new Error(cleanupError);

      const { data, error: enrollError } = await emailConfirmSupabase.auth.mfa.enroll({ factorType: 'phone', phone: normalized, friendlyName: PHONE_FRIENDLY_NAME });
      if (enrollError) throw enrollError;
      setPhone(normalized);
      setPhoneFactorId(data.id);
      setScreen('phone-code');
    } catch (err) {
      const message = getErrorMessage(err, 'Failed to send code');
      setError(
        isPhoneProviderUnavailableError(message)
          ? "Text-message sign-in isn't available yet — please use an authenticator app instead."
          : message,
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleVerifyPhone() {
    if (!phoneFactorId) return;
    setIsBusy(true);
    setError(null);
    const { error: verifyError } = await emailConfirmSupabase.auth.mfa.challengeAndVerify({ factorId: phoneFactorId, code: phoneCode });
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
        {screen === 'choose-method' && (
          <div className="space-y-4">
            <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Set up two-factor authentication</h2>
            <p className={bodyTextClass}>Choose how you&apos;d like to receive your sign-in codes.</p>
            <button onClick={() => { setError(null); setScreen('totp'); }} className={primaryButtonClass}>Use an authenticator app</button>
            {/* Supabase's Phone MFA factor type / SMS provider isn't connected
                yet (see CLAUDE.md's "MFA enrollment (unenforced)" section) —
                hide this option entirely until NEXT_PUBLIC_SMS_MFA_ENABLED=true
                is set (Vercel env var, needs a redeploy), rather than relying
                solely on the graceful in-flow error message for an option that
                can't work yet. Read at render time (not module scope) so it
                stays a plain build-time-inlined env check in production while
                still being easy to flip per-test. */}
            {process.env.NEXT_PUBLIC_SMS_MFA_ENABLED === 'true' && (
              <button onClick={choosePhoneMethod} className={primaryButtonClass}>Use a text message</button>
            )}
          </div>
        )}

        {screen === 'totp' && (
          <CodeEntryScreen
            title="Authenticator app"
            description="Scan the code below with an authenticator app (e.g. Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows."
            code={totpCode}
            onCodeChange={setTotpCode}
            onVerify={handleVerifyTotp}
            onBack={() => { setError(null); setScreen('choose-method'); }}
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

        {screen === 'phone-number' && (
          <div className="space-y-4">
            <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Text message</h2>
            <p className={bodyTextClass}>We&apos;ll send a code to this number.</p>
            <div>
              <label htmlFor="mfa-phone" className={labelClass}>Mobile number</label>
              <input
                id="mfa-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+61412345678"
                className={inputClass}
              />
            </div>
            {error && <p role="alert" className={errorBannerClass}>{error}</p>}
            <button onClick={handleSendPhoneCode} disabled={isBusy || !phone} className={primaryButtonClass}>
              {isBusy ? 'Sending…' : 'Send code'}
            </button>
            <button onClick={() => { setError(null); setScreen('choose-method'); }} disabled={isBusy} className={secondaryButtonClass}>← Back</button>
          </div>
        )}

        {screen === 'phone-code' && (
          <CodeEntryScreen
            title="Enter your code"
            description={`We sent a code to ${phone}.`}
            code={phoneCode}
            onCodeChange={setPhoneCode}
            onVerify={handleVerifyPhone}
            onBack={() => { setError(null); setScreen('phone-number'); }}
            error={error}
            isBusy={isBusy}
            disabled={!phoneFactorId}
          />
        )}
      </div>
    </div>
  );
}
