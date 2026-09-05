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

/**
 * Magic-link callback. Must run client-side (a page, not a Route Handler)
 * because exchangeCodeForSession() has to execute in the same browser
 * context that will go on to use the resulting session — supabase-js
 * persists sessions to localStorage, which only exists in the browser.
 *
 * This used to be a server Route Handler that ran the exchange using the
 * same browser-oriented `supabase` client — the exchange "succeeded"
 * server-side, but the session had no browser localStorage to persist to,
 * so the visitor was redirected with no session at all. See git history
 * for the original implementation.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const ranRef = useRef(false);

  useEffect(() => {
    // Guard against this one-time code exchange re-running on a re-render
    // (e.g. React 18 dev-mode double-invoke) — an auth code can only be
    // exchanged once.
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const next = safeRedirectPath(params.get('next'));

    if (!code) {
      router.replace('/login?error=auth_failed');
      return;
    }

    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      router.replace(error ? '/login?error=auth_failed' : next);
    });
  }, [router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p>Signing you in…</p>
    </div>
  );
}
