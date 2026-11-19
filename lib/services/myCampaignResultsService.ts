/**
 * A leader's own campaign results — one row per saved campaign report they
 * led, with just the date, location and the four tallies. Backs
 * GET /api/leader/my-campaign-results. Injected client (always supabaseAdmin,
 * since `campaign_reports` is admin-only under RLS).
 *
 * "Led" means the report's derived state + derived leader equal the caller's
 * own `state_leaders` row (both set from the campaign when a report is saved,
 * and from the sheet matcher/admin edits for older rows). Reports not yet
 * resolved to a leader are not shown — an admin fixes those at
 * /admin/campaign-reports. Never returns names of the people prayed with.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MyCampaignResultRow {
  id: string;
  /** ISO date (YYYY-MM-DD), or null when the report had no usable date. */
  campaignDate: string | null;
  /** The mapped State Places location, else what the leader typed. */
  location: string;
  partial: number | null;
  full: number | null;
  sinnersPrayers: number | null;
  followUp: number | null;
}

// PostgREST returns at most 1,000 rows per request by default.
export const MY_RESULTS_LIMIT = 1000;

interface ReportRow {
  id: string;
  campaign_date: string | null;
  derived_location: string | null;
  location_raw: string | null;
  partial_presentations: number | null;
  full_presentations: number | null;
  sinners_prayer: number | null;
  information_requests: number | null;
}

export async function getMyCampaignResults(
  client: SupabaseClient,
  leader: { state: string; leader: string },
): Promise<MyCampaignResultRow[]> {
  const { data, error } = await client
    .from('campaign_reports')
    .select('id, campaign_date, derived_location, location_raw, partial_presentations, full_presentations, sinners_prayer, information_requests')
    .eq('derived_state', leader.state)
    .eq('derived_leader', leader.leader)
    .order('campaign_date', { ascending: false, nullsFirst: false })
    .limit(MY_RESULTS_LIMIT);
  if (error) throw new Error(`Results lookup failed: ${error.message}`);

  return ((data ?? []) as ReportRow[]).map((r) => ({
    id: r.id,
    campaignDate: r.campaign_date,
    location: (r.derived_location || r.location_raw || '').trim(),
    partial: r.partial_presentations,
    full: r.full_presentations,
    sinnersPrayers: r.sinners_prayer,
    followUp: r.information_requests,
  }));
}
