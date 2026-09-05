/**
 * Supabase browser client for the /registry portal.
 *
 * This is a SEPARATE client instance from lib/supabaseClient.ts, pointed at
 * the same Supabase project (same URL/anon key) but given its own
 * localStorage key. Without that, both clients would share one session
 * slot in the browser: signing in here (real email + MFA) would silently
 * evict the main app's anonymous mobile+name session on the same device,
 * and vice versa. Giving /registry its own storage key lets both sessions
 * live side by side.
 *
 * `detectSessionInUrl: true` lets the SDK's own client-side URL detection
 * pick up the session in app/registry/auth/callback/page.tsx. This matters
 * more than it might look: supabase-js's default auth flow ('implicit')
 * delivers a magic-link/invite session as a #access_token=... URL hash
 * fragment, not a ?code= query param — confirmed live (a generated sign-in
 * link landed back on /registry/login with no session at all, because the
 * callback page was only ever looking for ?code=). detectSessionInUrl
 * handles both the implicit (#hash) and PKCE (?code=) shapes automatically
 * — see supabase-js's GoTrueClient._initialize() — so the callback page
 * doesn't need to parse the URL or call exchangeCodeForSession() itself at
 * all; it just needs to wait for the SDK to finish and fire SIGNED_IN.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are not set (registrySupabaseClient)');
}

export const registrySupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'afj-registry-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
