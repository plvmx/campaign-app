import { supabase } from '@/lib/supabaseClient';
import type { StuckLeader } from '@/lib/services/stuckLeadersService';

/** Browser-side call to GET /api/admin/stuck-leaders. Throws with the server's message on failure. */
export async function fetchStuckLeaders(): Promise<StuckLeader[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch('/api/admin/stuck-leaders', { headers: { Authorization: `Bearer ${session.access_token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to load the list');
  return (json as { leaders: StuckLeader[] }).leaders;
}
