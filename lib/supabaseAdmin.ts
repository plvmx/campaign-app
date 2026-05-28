/**
 * Supabase client with service role key. Use only on the server (API routes, server components).
 * Bypasses RLS - never expose this client to the browser.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in environment (Vercel env vars, .env.local).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// When env vars are absent (e.g. local dev without .env.local), return a Proxy
// that throws a clear diagnostic the first time any property is accessed, instead
// of a confusing "Cannot read properties of null" crash deep in call stacks.
const missingKeyProxy: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    throw new Error(
      `supabaseAdmin.${String(prop)} was called but SUPABASE_SERVICE_ROLE_KEY is not set. ` +
      'Add it to Vercel environment variables or .env.local.',
    );
  },
});

export const supabaseAdmin: SupabaseClient =
  url && key
    ? createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : missingKeyProxy;
