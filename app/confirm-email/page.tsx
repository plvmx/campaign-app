'use client';

import { useEffect, useRef, useState } from 'react';
import { emailConfirmSupabase } from '@/lib/emailConfirmSupabaseClient';

const GIVE_UP_AFTER_MS = 8000;

type Status = 'pending' | 'success' | 'error';

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
  const handledRef = useRef(false);

  useEffect(() => {
    async function handleSignedIn(session: { access_token: string }) {
      if (handledRef.current) return;
      handledRef.current = true;

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
          setStatus('success');
          setMessage(`Your email (${json.email}) has been confirmed.`);
        } else {
          setStatus('error');
          setMessage(json.error || 'Something went wrong confirming your email.');
        }
      } catch {
        setStatus('error');
        setMessage('Something went wrong confirming your email.');
      } finally {
        await emailConfirmSupabase.auth.signOut();
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
    };
  }, []);

  const cardClass =
    'w-full max-w-md space-y-4 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-blue-50 p-6 shadow-lg dark:bg-blue-900/20 sm:p-8';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className={cardClass}>
        <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">
          {status === 'success' ? 'Email confirmed' : status === 'error' ? 'Confirmation failed' : 'Confirming your email…'}
        </h2>
        {message && (
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">{message}</p>
        )}
      </div>
    </div>
  );
}
