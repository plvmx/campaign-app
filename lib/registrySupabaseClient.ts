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
 * `detectSessionInUrl` is off because the magic-link code exchange is done
 * explicitly in app/registry/auth/callback/page.tsx (same reasoning as the
 * fix to app/auth/callback: exchangeCodeForSession() must run in the
 * browser context that will use the resulting session, so we do it
 * ourselves rather than relying on the SDK's automatic URL detection,
 * which behaves differently across supabase-js versions/flow types).
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
    detectSessionInUrl: false,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
