import { supabase } from '@/lib/supabaseClient';
import type { InterestCounts } from '@/lib/services/interestCountsService';

/** Browser-side call to POST /api/leader/interest-counts (numbers only — no personal details). */
export async function fetchInterestCounts(campaignIds: string[]): Promise<InterestCounts> {
  if (campaignIds.length === 0) return { campaignInterest: {}, trainingInterest: {} };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch('/api/leader/interest-counts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaignIds }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to load interest counts');
  return json as InterestCounts;
}
