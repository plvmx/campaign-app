'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { getRegistryAccessState, setRegistryAuthCookie, setRegistrySessionCookie, signOutOfRegistry } from '@/lib/registryAuth';
import {
  RegistryAuthLayout,
  registryInputClass,
  registryLabelClass,
  registryPrimaryButtonClass,
  registryBodyTextClass,
} from '@/components/registry/RegistryAuthLayout';

const ROUTE_FOR_AUTHENTICATED_RESULT = {
  no_access: '/registry/no-access',
  needs_enrollment: '/registry/mfa/enroll',
  needs_challenge: '/registry/mfa/challenge',
  ok: '/registry',
} as const;

export default function RegistryLoginPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // The app's own registry_session cookie (a plain session cookie — no
  // max-age, see lib/registryAuth.ts) can go missing well before the
  // underlying Supabase session/refresh token actually does: the browser
  // itself closing, or a mobile browser evicting a backgrounded tab under
  // memory pressure. Landing here previously always showed a blank
  // sign-in form with no way to tell that apart from a genuine logout, so
  // a leader who was still perfectly signed in underneath would request a
  // needless brand-new magic link (reported live, 2026-09-25). Checking
  // for an existing session first catches that and carries them straight
  // through — same result-handling as app/registry/auth/callback/page.tsx.
  useEffect(() => {
    let cancelled = false;
    async function checkExistingSession() {
      const { result } = await getRegistryAccessState();
      if (result === 'unauthenticated') {
        if (!cancelled) setCheckingSession(false);
        return;
      }
      setRegistryAuthCookie();
      if (result === 'no_access') {
        await signOutOfRegistry();
      } else if (result === 'ok') {
        setRegistrySessionCookie();
      }
      if (!cancelled) router.replace(ROUTE_FOR_AUTHENTICATED_RESULT[result]);
    }
    checkExistingSession();
    return () => { cancelled = true; };
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const origin = window.location.origin;
      // shouldCreateUser: false — this portal is invite-only (an admin
      // creates the auth.users row + registry.leader_roles row via
      // scripts/seed_registry_leader_roles.ts). Anyone not already invited
      // gets the exact same "check your email" response below, so this
      // form never reveals whether an address is a recognized admin.
      await registrySupabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${origin}/registry/auth/callback`,
        },
      });
    } catch (err) {
      // Swallow — see the no-enumeration note above. Genuine outages are
      // rare enough that a leader simply retrying (or contacting the
      // national admin) is an acceptable fallback for a portal this small.
      console.error('registry sign-in request failed:', err);
    } finally {
      setIsSubmitting(false);
      setSent(true);
    }
  }

  if (checkingSession) {
    return (
      <RegistryAuthLayout title="AFJ Registry Sign In">
        <p className={registryBodyTextClass}>Checking sign-in status…</p>
      </RegistryAuthLayout>
    );
  }

  return (
    <RegistryAuthLayout title="AFJ Registry Sign In">
      <p className={registryBodyTextClass}>
        Registry Management (the registrations console) is built for a desktop or tablet screen — please use one of those rather than a mobile phone for the best experience.
      </p>
      {sent ? (
        <p className={registryBodyTextClass}>
          If that address has registry access, a sign-in link is on its way — check your email.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="registry-email" className={registryLabelClass}>Email address</label>
            <input
              id="registry-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={registryInputClass}
            />
          </div>
          <button type="submit" disabled={isSubmitting || !email} className={registryPrimaryButtonClass}>
            {isSubmitting ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      )}
    </RegistryAuthLayout>
  );
}
