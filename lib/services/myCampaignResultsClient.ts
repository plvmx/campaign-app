import { supabase } from '@/lib/supabaseClient';
import type { MyCampaignResultRow } from '@/lib/services/myCampaignResultsService';

/** Browser-side call to /api/leader/my-campaign-results. Throws with the server's message on failure. */
export async function fetchMyCampaignResults(): Promise<MyCampaignResultRow[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch('/api/leader/my-campaign-results', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Your results could not be loaded.');
  return (json as { results: MyCampaignResultRow[] }).results;
}
