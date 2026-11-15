/**
 * Saves a submitted TWOL Campaign Report from the combined page
 * (`/record-results/report`): the four counts become one `campaign_reports`
 * row and every typed name becomes a `results` row. Backs
 * POST /api/leader/campaign-report. Injected client (always supabaseAdmin,
 * since `campaign_reports` is admin-only under RLS) — the route has already
 * checked that the caller may record results for the campaign.
 *
 * Everything written is tagged `source = REPORT_SOURCE`. Saving a campaign
 * again REPLACES what it had: its earlier report row(s) from this page and all
 * of its Partial/Full/Sinners Prayer/Follow-up names — whichever screen they
 * came from, because the page shows them (`getSavedReportNames`) so the leader
 * edits rather than re-types them. Team Member (`TM`) names, which this page
 * has no field for, are never touched. The new rows are written BEFORE the old
 * ones are removed, so a failure part-way can leave a duplicate but never loses
 * what was there. Location, leader and date come from the campaign row, never
 * from the request; the derived state / location / leader are filled from it
 * too (location = the matching State Places row's `location`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NAME_MAX_LENGTH,
  formatReportLocation,
  type ReportCountField,
} from '@/lib/campaignReportEntry';
import { locationOf } from '@/lib/campaignReportMatcher';
import { combinePlaceAndSite } from '@/lib/placeSite';
import { parseReportCounts } from '@/lib/services/campaignReportEmailService';

/** `source` value on every row this page writes (campaign_reports and results). */
export const REPORT_SOURCE = 'app_report';

/** The marker used while the page was still being tested; those rows are replaced like any other. */
export const EXPERIMENTAL_REPORT_SOURCE = 'app_report_experimental';

/** Which `results.category_code` each count field's names are saved under. */
export const REPORT_FIELD_CATEGORY: Record<ReportCountField, 'P' | 'F' | 'SP' | 'IR'> = {
  partial: 'P',
  full: 'F',
  sinnersPrayers: 'SP',
  followUp: 'IR',
};

export interface ParsedReportSubmission {
  campaignId: string;
  counts: Record<ReportCountField, number>;
  names: Record<ReportCountField, string[]>;
}

const NAME_PATTERN = /^[A-Za-z ]+$/;

/**
 * Validates an untrusted request body: a campaign id, the four counts (0-99),
 * and for each count exactly that many names — letters and spaces only, 1-20
 * characters once trimmed. Returns null if anything is wrong.
 */
export function parseReportSubmission(body: unknown): ParsedReportSubmission | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as { campaignId?: unknown; names?: unknown };
  if (typeof raw.campaignId !== 'string' || raw.campaignId === '') return null;
  const counts = parseReportCounts(body);
  if (!counts || !raw.names || typeof raw.names !== 'object') return null;

  const namesIn = raw.names as Record<string, unknown>;
  const names = { partial: [], full: [], sinnersPrayers: [], followUp: [] } as Record<ReportCountField, string[]>;
  for (const field of Object.keys(names) as ReportCountField[]) {
    const list = namesIn[field];
    if (!Array.isArray(list) || list.length !== counts[field]) return null;
    for (const item of list) {
      if (typeof item !== 'string') return null;
      const name = item.trim();
      if (name === '' || name.length > NAME_MAX_LENGTH || !NAME_PATTERN.test(name)) return null;
      names[field].push(name);
    }
  }
  return { campaignId: raw.campaignId, counts, names };
}

export interface ReportCampaign {
  date: string;
  state: string;
  place: string;
  site: string;
  leader: string;
  mobile: string | null;
}

/** The campaign a report is about, or null if there is none with that id. */
export async function loadReportCampaign(client: SupabaseClient, campaignId: string): Promise<ReportCampaign | null> {
  const { data, error } = await client
    .from('campaigns')
    .select('date, state, place, site, leader, mobile')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the campaign: ${error.message}`);
  return (data as ReportCampaign | null) ?? null;
}

const FIELD_BY_CATEGORY = Object.fromEntries(
  (Object.keys(REPORT_FIELD_CATEGORY) as ReportCountField[]).map((f) => [REPORT_FIELD_CATEGORY[f], f]),
) as Record<string, ReportCountField>;

/** Names already saved for the campaign under the four categories, oldest first, for the page to show. */
export async function getSavedReportNames(
  client: SupabaseClient,
  campaignId: string,
): Promise<Record<ReportCountField, string[]>> {
  const { data, error } = await client
    .from('results')
    .select('first_name, category_code')
    .eq('campaign_id', campaignId)
    .in('category_code', Object.values(REPORT_FIELD_CATEGORY))
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not load the saved names: ${error.message}`);
  const names = { partial: [], full: [], sinnersPrayers: [], followUp: [] } as Record<ReportCountField, string[]>;
  for (const row of (data ?? []) as Array<{ first_name: string; category_code: string }>) {
    const field = FIELD_BY_CATEGORY[row.category_code];
    if (field) names[field].push(row.first_name);
  }
  return names;
}

const idsOf = (rows: unknown): string[] => ((rows ?? []) as Array<{ id: string }>).map((r) => r.id);

export async function saveCampaignReport(
  client: SupabaseClient,
  input: ParsedReportSubmission & { campaign: ReportCampaign; actorUserId: string },
): Promise<{ status: 'saved'; names: number }> {
  const { campaign, counts } = input;

  // What this save replaces (found now, removed only after the new rows are in).
  const { data: oldReports, error: oldReportsError } = await client
    .from('campaign_reports')
    .select('id')
    .eq('campaign_id', input.campaignId)
    .in('source', [REPORT_SOURCE, EXPERIMENTAL_REPORT_SOURCE]);
  if (oldReportsError) throw new Error(`Could not look up the earlier report: ${oldReportsError.message}`);
  const { data: oldResults, error: oldResultsError } = await client
    .from('results')
    .select('id')
    .eq('campaign_id', input.campaignId)
    .in('category_code', Object.values(REPORT_FIELD_CATEGORY));
  if (oldResultsError) throw new Error(`Could not look up the earlier names: ${oldResultsError.message}`);

  // The campaign already says which state and leader this is, and its place maps to a State Places
  // location, so fill the derived fields now rather than guessing from text later.
  const { data: places, error: placesError } = await client
    .from('state_places')
    .select('place, location')
    .eq('state', campaign.state);
  if (placesError) throw new Error(`Could not look up the location: ${placesError.message}`);
  const wanted = combinePlaceAndSite(campaign.place, campaign.site).trim().toLowerCase();
  const stateLocation = (places ?? []).find(
    (p: { place: string; location: string | null }) => p.place.trim().toLowerCase() === wanted,
  );

  const { data: report, error: reportError } = await client
    .from('campaign_reports')
    .insert({
      submitted_at: new Date().toISOString(),
      campaign_id: input.campaignId,
      campaign_date: campaign.date,
      campaign_date_raw: campaign.date,
      location_raw: formatReportLocation(campaign),
      leader_raw: campaign.leader,
      partial_presentations: counts.partial,
      partial_presentations_raw: String(counts.partial),
      full_presentations: counts.full,
      full_presentations_raw: String(counts.full),
      sinners_prayer: counts.sinnersPrayers,
      sinners_prayer_raw: String(counts.sinnersPrayers),
      information_requests: counts.followUp,
      information_requests_raw: String(counts.followUp),
      derived_state: campaign.state,
      derived_location: stateLocation ? locationOf({ ...stateLocation, state: campaign.state }) : null,
      derived_leader: campaign.leader?.trim() || null,
      needs_review: false,
      source: REPORT_SOURCE,
    })
    .select('id')
    .single();
  if (reportError || !report) throw new Error(`Could not save the report: ${reportError?.message ?? 'no row returned'}`);

  const resultRows = (Object.keys(REPORT_FIELD_CATEGORY) as ReportCountField[]).flatMap((field) =>
    input.names[field].map((first_name) => ({
      campaign_id: input.campaignId,
      first_name,
      category_code: REPORT_FIELD_CATEGORY[field],
      user_id: input.actorUserId,
      source: REPORT_SOURCE,
    })),
  );
  if (resultRows.length > 0) {
    const { error: resultsError } = await client.from('results').insert(resultRows);
    if (resultsError) {
      // Take back the report row just written; the earlier rows are still there.
      await client.from('campaign_reports').delete().eq('id', (report as { id: string }).id);
      throw new Error(`Could not save the names: ${resultsError.message}`);
    }
  }

  // Now remove what was there before.
  const oldResultIds = idsOf(oldResults);
  if (oldResultIds.length > 0) {
    const { error } = await client.from('results').delete().in('id', oldResultIds);
    if (error) throw new Error(`Saved, but could not clear the earlier names: ${error.message}`);
  }
  const oldReportIds = idsOf(oldReports);
  if (oldReportIds.length > 0) {
    const { error } = await client.from('campaign_reports').delete().in('id', oldReportIds);
    if (error) throw new Error(`Saved, but could not clear the earlier report: ${error.message}`);
  }
  return { status: 'saved', names: resultRows.length };
}
