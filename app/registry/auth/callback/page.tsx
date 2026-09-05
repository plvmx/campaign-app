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

/**
 * Magic-link callback for the /registry portal — mirrors the fix applied
 * to app/auth/callback: the code exchange must run client-side, in the
 * same browser context that will use the resulting session, not in a
 * server Route Handler.
 */
export default function RegistryAuthCallbackPage() {
  const router = useRouter();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // one-time code exchange; guard re-invocation
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (!code) {
      router.replace('/registry/login?error=auth_failed');
      return;
    }

    registrySupabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
      if (error) {
        router.replace('/registry/login?error=auth_failed');
        return;
      }

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
    });
  }, [router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p>Signing you in…</p>
    </div>
  );
}
