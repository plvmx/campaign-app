'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { getRegistryAccessState, setRegistryAuthCookie, setRegistrySessionCookie, signOutOfRegistry } from '@/lib/registryAuth';

const ROUTE_FOR_RESULT = {
  unauthenticated: '/registry/login?error=auth_failed',
  no_access: '/registry/no-access',
  needs_enrollment: '/registry/mfa/enroll',
  needs_challenge: '/registry/mfa/challenge',
  ok: '/registry',
} as const;

const GIVE_UP_AFTER_MS = 8000;

/**
 * Magic-link/invite callback for the /registry portal.
 *
 * Deliberately does NOT parse the URL or call exchangeCodeForSession()
 * itself — registrySupabaseClient.ts has detectSessionInUrl: true, so the
 * SDK already does that automatically on page load, handling both the
 * implicit (#access_token=... hash fragment, the project's actual default)
 * and PKCE (?code=...) callback shapes. This page just waits for that to
 * finish (a SIGNED_IN event, fired asynchronously — not necessarily before
 * this component's first render) and then runs the MFA/access gate.
 *
 * An earlier version of this page manually checked window.location.search
 * for a ?code= param and gave up immediately if absent — which is exactly
 * what broke a real sign-in attempt, since this project's actual callback
 * shape is the #hash one, never a ?code=. See git history / the sibling
 * fix to app/auth/callback for the identical mistake made there first.
 */
export default function RegistryAuthCallbackPage() {
  const router = useRouter();
  const handledRef = useRef(false);

  useEffect(() => {
    async function handleSignedIn() {
      if (handledRef.current) return;
      handledRef.current = true;

      // A session now exists; middleware needs this to admit /registry/mfa/*
      // even before we know whether the MFA gate will pass.
      setRegistryAuthCookie();

      const { result } = await getRegistryAccessState();

      if (result === 'no_access') {
        // A valid link doesn't imply valid registry access (e.g. the
        // leader_roles row was removed after the link was sent) — don't
        // leave a session sitting around for someone who shouldn't have one.
        await signOutOfRegistry();
      } else if (result === 'ok') {
        setRegistrySessionCookie();
      }

      router.replace(ROUTE_FOR_RESULT[result]);
    }

    const { data: { subscription } } = registrySupabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) handleSignedIn();
    });

    // Cover the race where detection already completed before this
    // listener was attached (onAuthStateChange only fires on the *next*
    // change, not for a session that already exists by the time we subscribe).
    registrySupabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleSignedIn();
    });

    // Nothing to wait for if the link was invalid/expired/already used —
    // the SDK won't produce a session or an event in that case, so without
    // this the visitor would be stuck on "Signing you in..." forever.
    const giveUp = setTimeout(() => {
      if (!handledRef.current) router.replace('/registry/login?error=auth_failed');
    }, GIVE_UP_AFTER_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(giveUp);
    };
  }, [router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p>Signing you in…</p>
    </div>
  );
}
