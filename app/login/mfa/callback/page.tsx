'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { completeLeaderAuthSignIn, PREFERS_EMAIL_MFA_LOGIN_KEY, type AuthedLeaderRow } from '@/lib/auth';
import { useUser } from '@/contexts/UserContext';
import { getLeaderRoleLabel } from '@/lib/leaderRoleLabel';
import { CodeEntryScreen, cardClass, bodyTextClass, primaryButtonClass, secondaryButtonClass } from '@/components/auth/CodeEntryScreen';

const GIVE_UP_AFTER_MS = 8000;

const NOT_ENROLLED_MESSAGE =
  "Two-factor authentication isn't set up for this account yet — please sign in with your mobile number and name instead.";

type Screen = 'waiting' | 'expired' | 'not-enrolled' | 'challenge' | 'role-picker';

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

  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<AuthedLeaderRow[]>([]);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  // Resolves sign-in once the account is known to be at aal2 (either
  // already, or right after a successful challenge): a single matching row
  // signs straight in, more than one shows a role picker.
  async function resolveRole(candidateRows: AuthedLeaderRow[], uid: string) {
    if (candidateRows.length === 1) {
      await finishSignIn(candidateRows[0], uid);
      return;
    }
    setIsBusy(false);
    setRows(candidateRows);
    setScreen('role-picker');
  }

  async function finishSignIn(row: AuthedLeaderRow, uid: string) {
    setIsBusy(true);
    await completeLeaderAuthSignIn(row, uid);
    // Remember on this device that this leader signs in via email + MFA, so
    // app/login/page.tsx can skip straight to /login/mfa next time instead
    // of showing the mobile+name form first (there's no session yet at that
    // point to detect this any other way).
    try {
      localStorage.setItem(PREFERS_EMAIL_MFA_LOGIN_KEY, '1');
    } catch { /* ignore (e.g. private browsing) */ }
    // Reload UserContext so it reads the profile just written, before
    // navigating — avoids a race where onAuthStateChange's own reload fires
    // before the upsert completes (same pattern app/login/page.tsx uses).
    await refreshUser();
    router.replace('/app');
  }

  useEffect(() => {
    async function handleSignedIn(session: { user: { id: string } }) {
      if (handledRef.current) return;
      handledRef.current = true;
      setUserId(session.user.id);

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
        await resolveRole(candidateRows, session.user.id);
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

    const giveUp = setTimeout(() => {
      if (!handledRef.current) setScreen('expired');
    }, GIVE_UP_AFTER_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(giveUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVerify() {
    if (!factorId) return;
    setIsBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (verifyError) {
      setIsBusy(false);
      setError(verifyError.message);
      return;
    }
    if (userId) await resolveRole(rows, userId);
  }

  async function handleCancel() {
    await supabase.auth.signOut();
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

  if (screen === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Link expired</h2>
          <p className={bodyTextClass}>This sign-in link is invalid or has expired.</p>
          <a href="/login/mfa" className={`${primaryButtonClass} block text-center`}>Back to sign in</a>
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
            <div className="flex flex-col gap-3">
              {rows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => userId && finishSignIn(row, userId)}
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
