'use client';

import { useEffect, useRef, useState } from 'react';
import { emailConfirmSupabase } from '@/lib/emailConfirmSupabaseClient';
import { primaryButtonClass, bodyTextClass, cardClass } from '@/components/auth/CodeEntryScreen';
import { EmailAndCodeFallback } from '@/components/auth/EmailAndCodeFallback';
import { MfaEnrollmentFlow, type MfaEnrollmentOutcome } from '@/components/auth/MfaEnrollmentFlow';

const GIVE_UP_AFTER_MS = 8000;

type Screen = 'waiting' | 'expired' | 'cancelled' | 'enrolling' | 'success';

/**
 * MFA enrollment landing page for the leader self-serve flow (see
 * app/api/auth/request-mfa-setup/route.ts and
 * app/api/auth/complete-mfa-setup/route.ts). Reuses
 * lib/emailConfirmSupabaseClient.ts (shared with app/confirm-email/page.tsx)
 * for the same reason that page does: an isolated session to prove identity
 * via magic link. Unlike /confirm-email's old behavior, this session has to
 * stay alive through a multi-step enrollment UI rather than being signed out
 * immediately — the enrollment steps themselves (and the abandonment timer
 * that bounds that window) live in components/auth/MfaEnrollmentFlow.tsx,
 * shared with /confirm-email.
 */
export default function SetupMfaPage() {
  const [screen, setScreen] = useState<Screen>('waiting');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const handledRef = useRef(false);

  // Sign-in wait — identical pattern to app/confirm-email/page.tsx.
  useEffect(() => {
    function handleSignedIn(session: { access_token: string }) {
      if (handledRef.current) return;
      handledRef.current = true;
      setAccessToken(session.access_token);
      setScreen('enrolling');
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
    };
  }, []);

  function handleEnrollmentDone(outcome: MfaEnrollmentOutcome) {
    setScreen(outcome);
  }

  // Recovery path when the link itself already failed (e.g. Apple Mail
  // Privacy Protection silently consumed it before the leader ever tapped
  // it — confirmed live, 2026-10-05). Just needs to call verifyOtp() and
  // throw on failure; the onAuthStateChange listener registered in the
  // sign-in-wait effect above is still subscribed (the failed first attempt
  // never ran handleSignedIn, so nothing blocks it firing again) and runs
  // the exact same enrollment flow a working link would have.
  async function handleRecoveryVerify(email: string, code: string) {
    const { error } = await emailConfirmSupabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
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
          <EmailAndCodeFallback onVerify={handleRecoveryVerify} />
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
        {accessToken && <MfaEnrollmentFlow accessToken={accessToken} onDone={handleEnrollmentDone} />}
      </div>
    </div>
  );
}
