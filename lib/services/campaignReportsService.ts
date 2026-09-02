/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Read/write for the manual cleanup screen (/admin/campaign-reports-cleanup)
 * that lets an admin fill in derived_state/derived_place/derived_leader for
 * campaign_reports rows lib/campaignReportMatcher.ts couldn't confidently
 * resolve on its own.
 */
import { supabase } from '@/lib/supabaseClient';

export interface CampaignReportForReview {
  id: string;
  submitted_at: string;
  campaign_date: string | null;
  campaign_date_raw: string | null;
  location_raw: string | null;
  leader_raw: string | null;
  derived_state: string | null;
  derived_place: string | null;
  derived_leader: string | null;
}

/**
 * Rows submitted on/after `sinceDate` where at least one of
 * derived_state/derived_place/derived_leader is still null — i.e. what
 * lib/campaignReportMatcher.ts couldn't fully resolve on its own. Relies on
 * campaign_reports' existing admin-only SELECT policy (see
 * supabase/rls-policies.sql) rather than an app-level role check.
 */
export async function getCampaignReportsNeedingReview(sinceDate: string): Promise<CampaignReportForReview[]> {
  const { data, error } = await supabase
    .from('campaign_reports')
    .select('id, submitted_at, campaign_date, campaign_date_raw, location_raw, leader_raw, derived_state, derived_place, derived_leader')
    .gte('submitted_at', sinceDate)
    .or('derived_state.is.null,derived_place.is.null,derived_leader.is.null')
    .order('submitted_at', { ascending: true });

  if (error) throw error;
  return (data || []) as CampaignReportForReview[];
}

export interface DerivedFieldsUpdate {
  derived_state: string | null;
  derived_place: string | null;
  derived_leader: string | null;
}

/**
 * Saves a manual correction to one row's derived fields. Goes through
 * /api/admin/campaign-reports/derived-fields (service role) rather than a
 * direct client update — campaign_reports has no authenticated write policy
 * yet (see the comment above the RLS block in supabase/rls-policies.sql), so
 * an admin's own UPDATE would otherwise be silently rejected by RLS.
 */
export async function updateCampaignReportDerivedFields(
  id: string,
  updates: DerivedFieldsUpdate,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch('/api/admin/campaign-reports/derived-fields', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ id, ...updates }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to save (${response.status})`);
  }
}
