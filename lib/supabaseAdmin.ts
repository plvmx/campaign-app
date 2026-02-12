/**
 * Supabase client with service role key. Use only on the server (API routes, server components).
 * Bypasses RLS - never expose this client to the browser.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in environment (Vercel env vars, .env.local).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseAdmin: SupabaseClient =
  url && key
    ? createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient); // Build succeeds; runtime will fail if used without key
