'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { cardClass, bodyTextClass, primaryButtonClass, inputClass, labelClass } from '@/components/auth/CodeEntryScreen';

/**
 * Email + magic-link entry point for leaders who've confirmed their email
 * and set up an authenticator app (see app/setup-mfa/page.tsx) — mirrors
 * app/registry/login/page.tsx's mechanics closely, applied to state_leaders
 * instead of registry.leader_roles. Mobile+name (app/login/page.tsx) stays
 * the only option for everyone else; this is purely additive.
 *
 * Uses the MAIN supabase client (lib/supabaseClient.ts), not an isolated
 * one like app/confirm-email or app/setup-mfa use — those flows prove
 * identity and then immediately discard the session (signOut()) so it can
 * never collide with a leader's live anonymous app session. Here the
 * opposite is true: this magic-link session is meant to *become* the
 * leader's new real, persistent identity, replacing whatever anonymous
 * session existed. lib/supabaseClient.ts already has detectSessionInUrl:
 * true, so app/login/mfa/callback/page.tsx picks the session up automatically.
 */
export default function LoginMfaPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // A real (non-anonymous) session already signed in via this flow before —
  // let app/login/mfa/callback/page.tsx re-resolve it (role picker / straight
  // through to /app) instead of asking for an email again. An anonymous
  // session (today's mobile+name flow) is not "already signed in" for this
  // flow's purposes, so it's ignored here and the form still shows.
  useEffect(() => {
    let cancelled = false;
    async function checkExistingSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && !session.user.is_anonymous) {
        if (!cancelled) router.replace('/login/mfa/callback');
        return;
      }
      if (!cancelled) setCheckingSession(false);
    }
    checkExistingSession();
    return () => { cancelled = true; };
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const origin = window.location.origin;
      // shouldCreateUser: false — by the time a leader can reach this state
      // (confirmed email + enrolled MFA), their auth.users row already
      // exists from the original email-capture magic link. Always shows
      // "check your email" below regardless of outcome, so this form never
      // reveals whether an address is a recognized, enrolled leader.
      await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${origin}/login/mfa/callback`,
        },
      });
    } catch (err) {
      console.error('leader email sign-in request failed:', err);
    } finally {
      setIsSubmitting(false);
      setSent(true);
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Checking sign-in status…</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className={cardClass}>
        <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Sign in with email</h2>
        {sent ? (
          <p className={bodyTextClass}>
            If that address has two-factor authentication set up, a sign-in link is on its way — check your email.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="leader-email" className={labelClass}>Email address</label>
              <input
                id="leader-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={inputClass}
              />
            </div>
            <button type="submit" disabled={isSubmitting || !email} className={primaryButtonClass}>
              {isSubmitting ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
        {/* ?mode=mobile bypasses /login's own "prefers email+MFA" redirect
            just this once, without clearing that remembered preference —
            see app/login/page.tsx's checkExistingSession. */}
        <a href="/login?mode=mobile" className="block text-center text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
          ← Back to mobile + name sign in
        </a>
      </div>
    </div>
  );
}
