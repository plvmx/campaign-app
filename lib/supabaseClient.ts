import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are not set');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true, // Persist session in localStorage (default, but explicit)
    autoRefreshToken: true, // Automatically refresh tokens
    detectSessionInUrl: true, // Detect session from URL (for OAuth callbacks)
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});

