'use client';

import { useEffect, useRef, useState } from 'react';
import { emailConfirmSupabase } from '@/lib/emailConfirmSupabaseClient';
import { EmailAndCodeFallback } from '@/components/auth/EmailAndCodeFallback';
import { primaryButtonClass, secondaryButtonClass, bodyTextClass, cardClass } from '@/components/auth/CodeEntryScreen';
import { MfaEnrollmentFlow, MFA_ABANDON_AFTER_MS, type MfaEnrollmentOutcome } from '@/components/auth/MfaEnrollmentFlow';

const GIVE_UP_AFTER_MS = 8000;

// 'confirmed' = email confirmed, leader is choosing whether to set up 2FA now;
// 'enrolling' = running MfaEnrollmentFlow; 'done' = finished/declined/timed
// out (the session is signed out by then, whichever way it got here).
type Status = 'pending' | 'confirmed' | 'enrolling' | 'done' | 'error';

/**
 * Magic-link confirmation landing page for the leader self-serve
 * email-capture flow (see app/api/auth/propose-email/route.ts and
 * app/api/auth/confirm-email/route.ts). Deliberately does NOT parse the URL
 * or call exchangeCodeForSession() itself — emailConfirmSupabaseClient.ts
 * has detectSessionInUrl: true, so the SDK already does that automatically,
 * handling both the implicit (#hash, this project's actual shape) and PKCE
 * (?code=) callback shapes. This page just waits for a SIGNED_IN event.
 *
 * Not the same path as the existing (dead) app/auth/callback — that's a
 * different, later-phase flow where the magic-link session is meant to
 * *become* the app session. Here the session's only job is to prove inbox
 * control; it is always signed out again once confirm-email/route.ts has
 * responded, so it never persists or collides with the leader's real
 * anonymous app session (see lib/emailConfirmSupabaseClient.ts's comment).
 * No UserContext/router integration needed — this page doesn't change what
 * the leader is signed into.
 */
export default function ConfirmEmailPage() {
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [doneKind, setDoneKind] = useState<MfaEnrollmentOutcome | 'skipped' | 'timed-out'>('skipped');
  const handledRef = useRef(false);
  const choiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearChoiceTimer() {
    if (choiceTimerRef.current) {
      clearTimeout(choiceTimerRef.current);
      choiceTimerRef.current = null;
    }
  }

  useEffect(() => {
    async function handleSignedIn(session: { access_token: string }) {
      if (handledRef.current) return;
      handledRef.current = true;

      // The session is only kept alive on the one path where the leader is
      // then offered 2FA setup; every other path signs it out here.
      let keepSession = false;
      try {
        // leaderId travels as a query param on the magic-link redirect (set by
        // propose-email/route.ts) so confirm-email/route.ts can scope its
        // commit to this one row rather than any row sharing the same
        // pending_email string — see that route's own comment for why.
        const leaderId = new URLSearchParams(window.location.search).get('leaderId') ?? '';
        const res = await fetch('/api/auth/confirm-email', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ leaderId }),
        });
        const json = await res.json();
        if (res.ok) {
          keepSession = true;
          setAccessToken(session.access_token);
          setStatus('confirmed');
          setMessage(`Your email (${json.email}) has been confirmed.`);
          choiceTimerRef.current = setTimeout(async () => {
            await emailConfirmSupabase.auth.signOut();
            setDoneKind('timed-out');
            setStatus('done');
          }, MFA_ABANDON_AFTER_MS);
        } else {
          setStatus('error');
          setMessage(json.error || 'Something went wrong confirming your email.');
        }
      } catch {
        setStatus('error');
        setMessage('Something went wrong confirming your email.');
      } finally {
        if (!keepSession) await emailConfirmSupabase.auth.signOut();
      }
    }

    const { data: { subscription } } = emailConfirmSupabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) handleSignedIn(session);
    });

    // Cover the race where detection already completed before this
    // listener was attached (onAuthStateChange only fires on the *next*
    // change, not for a session that already exists by the time we subscribe).
    emailConfirmSupabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleSignedIn(session);
    });

    // Nothing to wait for if the link was invalid/expired/already used —
    // the SDK won't produce a session or an event in that case.
    const giveUp = setTimeout(() => {
      if (!handledRef.current) {
        setStatus('error');
        setMessage('This confirmation link is invalid or has expired.');
      }
    }, GIVE_UP_AFTER_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(giveUp);
      clearChoiceTimer();
    };
  }, []);

  async function handleSkip() {
    clearChoiceTimer();
    await emailConfirmSupabase.auth.signOut();
    window.location.assign('/app');
  }

  function handleSetUpNow() {
    clearChoiceTimer();
    setStatus('enrolling');
  }

  function handleEnrollmentDone(outcome: MfaEnrollmentOutcome) {
    setDoneKind(outcome);
    setStatus('done');
  }

  // Recovery path when the link itself already failed (e.g. Apple Mail
  // Privacy Protection silently consumed it before the leader ever tapped
  // it — confirmed live, 2026-10-05). Just needs to call verifyOtp() and
  // throw on failure; the onAuthStateChange listener registered in the
  // effect above is still subscribed (the failed first attempt never ran
  // handleSignedIn, so nothing blocks it firing again) and runs the exact
  // same confirm-email flow a working link would have.
  async function handleRecoveryVerify(email: string, code: string) {
    const { error } = await emailConfirmSupabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
  }

  const doneHeading =
    doneKind === 'success' ? 'Two-factor authentication is set up' : 'Email confirmed';
  const doneText =
    doneKind === 'success'
      ? "You're all set — no further action needed today."
      : doneKind === 'expired' || doneKind === 'timed-out'
        ? 'For your security this page timed out. Your email is confirmed — you can set up two-factor authentication another time.'
        : 'No problem — your email is confirmed, and you can set up two-factor authentication another time.';

  const continueNote = (
    <p className={bodyTextClass}>
      If you are taken to a sign-in screen, go back to the AFJ app where you started signing in — your email is already confirmed.
    </p>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className={cardClass}>
        {status === 'enrolling' && accessToken ? (
          <MfaEnrollmentFlow accessToken={accessToken} onDone={handleEnrollmentDone} />
        ) : (
          <>
            <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">
              {status === 'confirmed'
                ? 'Email confirmed'
                : status === 'done'
                  ? doneHeading
                  : status === 'error'
                    ? 'Confirmation failed'
                    : 'Confirming your email…'}
            </h2>
            {status === 'done' ? (
              <p className="text-center text-sm text-gray-600 dark:text-gray-400">{doneText}</p>
            ) : (
              message && <p className="text-center text-sm text-gray-600 dark:text-gray-400">{message}</p>
            )}
            {status === 'confirmed' && (
              <>
                <p className={bodyTextClass}>
                  Would you also like to set up two-factor authentication now? It adds extra security to your account and takes about two minutes.
                </p>
                <button onClick={handleSetUpNow} className={primaryButtonClass}>Set up two-factor authentication</button>
                <button onClick={handleSkip} className={secondaryButtonClass}>Skip for now</button>
                {continueNote}
              </>
            )}
            {status === 'done' && (
              <>
                <a href="/app" className={`${primaryButtonClass} block text-center`}>Continue</a>
                {continueNote}
              </>
            )}
            {status === 'error' && (
              <>
                <a href="/login" className={`${primaryButtonClass} block text-center`}>Back to sign in</a>
                <EmailAndCodeFallback onVerify={handleRecoveryVerify} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
