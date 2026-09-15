'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

// Only allow relative paths that start with '/' but not '//' (protocol-relative URLs).
// new URL('https://evil.com', origin) ignores the origin, so we must validate first.
function safeRedirectPath(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/app';
}

const GIVE_UP_AFTER_MS = 8000;

/**
 * Magic-link callback. Must run client-side (a page, not a Route Handler)
 * because the session has to land in the same browser context that will
 * go on to use it — supabase-js persists sessions to localStorage, which
 * only exists in the browser.
 *
 * This page deliberately does NOT parse the URL or call
 * exchangeCodeForSession() itself — lib/supabaseClient.ts already has
 * detectSessionInUrl: true, so the SDK does that automatically on page
 * load. That matters more than it might look: supabase-js's default auth
 * flow ('implicit') delivers a magic-link session as a
 * #access_token=...&refresh_token=... URL hash fragment, not a ?code=
 * query param — confirmed live while building the /registry portal's
 * identical callback (see that page's own comment/history): checking only
 * for ?code= and giving up immediately when absent means every genuine
 * successful sign-in gets treated as a failure. detectSessionInUrl
 * handles both the implicit (#hash) and PKCE (?code=) shapes automatically
 * (see supabase-js's GoTrueClient._initialize()), so this page just needs
 * to wait for that to finish and fire SIGNED_IN.
 *
 * This used to be a server Route Handler running exchangeCodeForSession()
 * with the same browser-oriented `supabase` client — the exchange
 * "succeeded" server-side, but the session had no browser localStorage to
 * persist to, so the visitor was redirected with no session at all. See
 * git history for that version.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const handledRef = useRef(false);

  useEffect(() => {
    function handleSignedIn() {
      if (handledRef.current) return;
      handledRef.current = true;

      const params = new URLSearchParams(window.location.search);
      const next = safeRedirectPath(params.get('next'));
      router.replace(next);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) handleSignedIn();
    });

    // Cover the race where detection already completed before this
    // listener was attached (onAuthStateChange only fires on the *next*
    // change, not for a session that already exists by the time we subscribe).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleSignedIn();
    });

    // Nothing to wait for if the link was invalid/expired/already used —
    // the SDK won't produce a session or an event in that case, so without
    // this the visitor would be stuck on "Signing you in..." forever.
    const giveUp = setTimeout(() => {
      if (!handledRef.current) router.replace('/login?error=auth_failed');
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
