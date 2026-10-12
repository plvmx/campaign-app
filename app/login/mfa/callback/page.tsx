'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { completeLeaderAuthSignIn, signOutClearingAccess, PREFERS_EMAIL_MFA_LOGIN_KEY, type AuthedLeaderRow } from '@/lib/auth';
import { useUser } from '@/contexts/UserContext';
import { getLeaderRoleLabel } from '@/lib/leaderRoleLabel';
import { CodeEntryScreen, cardClass, bodyTextClass, primaryButtonClass, secondaryButtonClass, errorBannerClass } from '@/components/auth/CodeEntryScreen';
import { getErrorMessage } from '@/lib/errorUtils';
import { describeMfaVerifyError } from '@/lib/mfaErrors';
import { EmailAndCodeFallback } from '@/components/auth/EmailAndCodeFallback';
import { TapToContinue } from '@/components/auth/TapToContinue';
import { clearPendingLoginStep } from '@/lib/pendingLoginStep';
import { readTokenHashFromUrl, stripTokenHashFromUrl } from '@/lib/magicLinkToken';

const GIVE_UP_AFTER_MS = 8000;

const NOT_ENROLLED_MESSAGE =
  "Two-factor authentication isn't set up for this account yet — please sign in with your mobile number and name instead.";

type Screen = 'waiting' | 'tap' | 'expired' | 'not-enrolled' | 'challenge' | 'role-picker';

/**
 * Magic-link callback for the real-auth + MFA leader login path
 * (app/login/mfa/page.tsx) — mirrors app/registry/auth/callback/page.tsx +
 * app/registry/mfa/challenge/page.tsx's combined mechanics, applied to
 * state_leaders.user_id instead of registry.leader_roles.
 *
 * Deliberately does NOT parse the URL or call exchangeCodeForSession()
 * itself — lib/supabaseClient.ts has detectSessionInUrl: true, so the SDK
 * already does that automatically on page load (see the identical comment
 * on app/registry/auth/callback/page.tsx for the implicit-vs-PKCE history
 * behind this). This page just waits for the resulting SIGNED_IN event and
 * runs the MFA-gate + role-resolution logic.
 *
 * Uses the MAIN supabase client, not an isolated one — this session is
 * meant to become the leader's persistent app identity (see
 * app/login/mfa/page.tsx's header comment for the full rationale).
 */
export default function LoginMfaCallbackPage() {
  const router = useRouter();
  const { refresh: refreshUser } = useUser();
  const handledRef = useRef(false);

  const [screen, setScreen] = useState<Screen>('waiting');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Scanner-proof link: the token is only used when the person taps the button (lib/magicLinkToken.ts).
  const [tokenHash, setTokenHash] = useState<string | null>(null);

  const [rows, setRows] = useState<AuthedLeaderRow[]>([]);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  // Resolves sign-in once the account is known to be at aal2 (either
  // already, or right after a successful challenge): a single matching row
  // signs straight in, more than one shows a role picker.
  async function resolveRole(candidateRows: AuthedLeaderRow[]) {
    if (candidateRows.length === 1) {
      await finishSignIn(candidateRows[0]);
      return;
    }
    setIsBusy(false);
    setRows(candidateRows);
    setScreen('role-picker');
  }

  async function finishSignIn(row: AuthedLeaderRow) {
    setIsBusy(true);
    setError(null);
    try {
      await completeLeaderAuthSignIn(row);
    } catch (err) {
      // The server refused (or the request failed) — stay on this screen with
      // a message rather than navigating on as if signed in.
      setIsBusy(false);
      setError(getErrorMessage(err, 'Failed to complete sign-in. Please try again.'));
      return;
    }
    // A signed-in leader must not later be shown someone else's remembered /login step.
    clearPendingLoginStep();
    // Remember on this device that this leader signs in via email + MFA, so
    // app/login/page.tsx can skip straight to /login/mfa next time instead
    // of showing the mobile+name form first (there's no session yet at that
    // point to detect this any other way).
    try {
      localStorage.setItem(PREFERS_EMAIL_MFA_LOGIN_KEY, '1');
    } catch { /* ignore (e.g. private browsing) */ }
    // Reload UserContext so it reads the profile just written, before
    // navigating — avoids a race where onAuthStateChange's own reload fires
    // before the server's write is visible (same pattern app/login/page.tsx uses).
    await refreshUser();
    router.replace('/app');
  }

  useEffect(() => {
    async function handleSignedIn(session: { user: { id: string } }) {
      if (handledRef.current) return;
      handledRef.current = true;

      const { data, error: rowsError } = await supabase
        .from('state_leaders')
        .select('id, state, leader, admin, mfa_enrolled_at')
        .eq('user_id', session.user.id);

      const candidateRows = (data ?? []) as (AuthedLeaderRow & { mfa_enrolled_at: string | null })[];
      if (rowsError || candidateRows.length === 0 || !candidateRows.some((r) => r.mfa_enrolled_at)) {
        setScreen('not-enrolled');
        return;
      }

      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData?.currentLevel === 'aal2') {
        await resolveRole(candidateRows);
        return;
      }

      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verified = factorsData?.totp.find((f) => f.status === 'verified');
      if (!verified) {
        // mfa_enrolled_at is set but no verified factor exists — data drift
        // (e.g. the factor was removed after enrollment). Same fallback as
        // "not enrolled at all", since the practical guidance is identical.
        setScreen('not-enrolled');
        return;
      }
      setFactorId(verified.id);
      setRows(candidateRows);
      setScreen('challenge');
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) handleSignedIn(session);
    });

    // Race guard: detection may already have completed before this listener
    // attached (onAuthStateChange only fires on the *next* change).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleSignedIn(session);
    });

    // A token in the URL means "wait for the person to tap"; the give-up
    // clock only starts once they do (handleTap).
    const urlTokenHash = readTokenHashFromUrl();
    if (urlTokenHash) {
      Promise.resolve().then(() => {
        setTokenHash(urlTokenHash);
        setScreen('tap');
      });
    }
    const giveUp = urlTokenHash
      ? null
      : setTimeout(() => {
          if (!handledRef.current) setScreen('expired');
        }, GIVE_UP_AFTER_MS);

    return () => {
      subscription.unsubscribe();
      if (giveUp) clearTimeout(giveUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleTap() {
    if (!tokenHash) return;
    const token = tokenHash;
    setTokenHash(null);
    setScreen('waiting');
    stripTokenHashFromUrl();
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: token, type: 'email' });
    if (verifyError) {
      setScreen('expired');
      return;
    }
    // SIGNED_IN reaches the listener above; if it somehow never does, don't hang.
    setTimeout(() => {
      if (!handledRef.current) setScreen('expired');
    }, GIVE_UP_AFTER_MS);
  }

  async function handleVerify() {
    if (!factorId) return;
    setIsBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (verifyError) {
      setIsBusy(false);
      setError(describeMfaVerifyError(verifyError));
      return;
    }
    await resolveRole(rows);
  }

  // Recovery path when the link itself already failed (e.g. Apple Mail
  // Privacy Protection silently consumed it before the leader ever tapped
  // it — confirmed live, 2026-10-05). Just needs to call verifyOtp() and
  // throw on failure; the onAuthStateChange listener registered in the
  // effect above is still subscribed (the failed first attempt never ran
  // handleSignedIn, so nothing blocks it firing again) and runs the exact
  // same MFA-gate/role-resolution flow a working link would have.
  async function handleRecoveryVerify(email: string, code: string) {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
  }

  async function handleCancel() {
    await signOutClearingAccess();
    router.replace('/login/mfa');
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

  if (screen === 'tap') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <TapToContinue
            title="One last step"
            description="Tap the button below to finish signing in."
            buttonLabel="Finish signing in"
            isBusy={false}
            onTap={handleTap}
          />
        </div>
      </div>
    );
  }

  if (screen === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">That link has already been used</h2>
          <p className={bodyTextClass}>The link has expired, or it was already used — some email programs open links automatically, which uses them up.</p>
          <EmailAndCodeFallback onVerify={handleRecoveryVerify} />
          <a href="/login/mfa" className={`${secondaryButtonClass} block text-center`}>Back to sign in</a>
        </div>
      </div>
    );
  }

  if (screen === 'not-enrolled') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Not set up yet</h2>
          <p className={bodyTextClass}>{NOT_ENROLLED_MESSAGE}</p>
          <a href="/login" className={`${primaryButtonClass} block text-center`}>Back to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className={cardClass}>
        {screen === 'challenge' && (
          <CodeEntryScreen
            title="Enter your authenticator code"
            description="Enter the 6-digit code from your authenticator app to finish signing in."
            code={code}
            onCodeChange={setCode}
            onVerify={handleVerify}
            onBack={handleCancel}
            backLabel="Cancel"
            error={error}
            isBusy={isBusy}
            disabled={!factorId}
          />
        )}

        {screen === 'role-picker' && (
          <div className="space-y-4">
            <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Which role are you signing in as?</h2>
            <p className={bodyTextClass}>You have more than one role on file.</p>
            {error && <p role="alert" className={errorBannerClass}>{error}</p>}
            <div className="flex flex-col gap-3">
              {rows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => finishSignIn(row)}
                  disabled={isBusy}
                  className={primaryButtonClass}
                >
                  {getLeaderRoleLabel(row.admin, row.state)}
                </button>
              ))}
            </div>
            <button onClick={handleCancel} disabled={isBusy} className={secondaryButtonClass}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
