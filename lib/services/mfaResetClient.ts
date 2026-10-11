import { supabase } from '@/lib/supabaseClient';

/** Browser-side call to POST /api/admin/reset-mfa. Throws with the server's
 * message on failure. (Separate file from mfaResetService.ts so the server
 * code doesn't import the browser Supabase client.) */
export async function requestMfaReset(leaderId: string): Promise<{ factorsRemoved: number; rowsReset: number }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch('/api/admin/reset-mfa', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaderId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to reset two-factor authentication');
  return json as { factorsRemoved: number; rowsReset: number };
}
