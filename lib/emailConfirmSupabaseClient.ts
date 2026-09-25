/**
 * Supabase browser client shared by /confirm-email and /setup-mfa — both
 * need the identical "isolated session to prove identity via magic link,
 * then sign out" shape, so this file is reused rather than adding a third
 * near-duplicate of lib/registrySupabaseClient.ts's own isolated-client
 * pattern.
 *
 * A SEPARATE client instance from lib/supabaseClient.ts, pointed at the same
 * Supabase project but with its own localStorage key — exactly mirroring
 * lib/registrySupabaseClient.ts, and for the same reason: without this,
 * detecting the magic-link session here would overwrite the leader's real
 * anonymous app session in the shared storage slot, and this page's own
 * signOut() (see app/confirm-email/page.tsx) would then destroy it —
 * logging them out of the app entirely.
 *
 * `detectSessionInUrl: true` lets the SDK's own client-side URL detection
 * pick up the session on this page — this project's magic-link flow is the
 * implicit (#access_token=... hash) shape, not PKCE (?code=...), confirmed
 * live for /registry (see registrySupabaseClient.ts's own header comment).
 * The page must never parse the URL or call exchangeCodeForSession() itself;
 * it just waits for the SDK to finish and fire SIGNED_IN.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are not set (emailConfirmSupabaseClient)');
}

export const emailConfirmSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'afj-email-confirm-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
