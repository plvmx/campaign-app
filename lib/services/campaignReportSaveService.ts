/**
 * Saves a submitted TWOL Campaign Report from the experimental combined page
 * (`/record-results/report`): the four counts become one `campaign_reports`
 * row and every typed name becomes a `results` row. Backs
 * POST /api/admin/campaign-report-save. Injected client (always supabaseAdmin,
 * since `campaign_reports` is admin-only under RLS).
 *
 * Everything written is tagged `source = EXPERIMENTAL_REPORT_SOURCE` so it can
 * be found and deleted later without touching real data, and saving the same
 * campaign again REPLACES its earlier experimental rows rather than adding
 * duplicates. Location, leader and date come from the campaign row, never from
 * the request.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NAME_MAX_LENGTH,
  formatReportLocation,
  type ReportCountField,
} from '@/lib/campaignReportEntry';
import { parseReportCounts } from '@/lib/services/campaignReportEmailService';

/** `source` value on every row the experimental page writes (campaign_reports and results). */
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

export type SaveReportResult = { status: 'saved'; names: number } | { status: 'campaign_not_found' };

export async function saveCampaignReport(
  client: SupabaseClient,
  input: ParsedReportSubmission & { actorUserId: string },
): Promise<SaveReportResult> {
  const { data: campaign, error: campaignError } = await client
    .from('campaigns')
    .select('date, state, place, site, leader')
    .eq('id', input.campaignId)
    .maybeSingle();
  if (campaignError) throw new Error(`Could not load the campaign: ${campaignError.message}`);
  if (!campaign) return { status: 'campaign_not_found' };

  // Replace, don't duplicate: clear this campaign's earlier experimental rows (and only those).
  await deleteExperimentalRows(client, input.campaignId);

  const { counts } = input;
  const { error: reportError } = await client.from('campaign_reports').insert({
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
    needs_review: false,
    source: EXPERIMENTAL_REPORT_SOURCE,
  });
  if (reportError) throw new Error(`Could not save the report: ${reportError.message}`);

  const resultRows = (Object.keys(REPORT_FIELD_CATEGORY) as ReportCountField[]).flatMap((field) =>
    input.names[field].map((first_name) => ({
      campaign_id: input.campaignId,
      first_name,
      category_code: REPORT_FIELD_CATEGORY[field],
      user_id: input.actorUserId,
      source: EXPERIMENTAL_REPORT_SOURCE,
    })),
  );
  if (resultRows.length > 0) {
    const { error: resultsError } = await client.from('results').insert(resultRows);
    if (resultsError) {
      // Don't leave a report with no names behind; best-effort undo, then report the failure.
      await deleteExperimentalRows(client, input.campaignId).catch(() => undefined);
      throw new Error(`Could not save the names: ${resultsError.message}`);
    }
  }
  return { status: 'saved', names: resultRows.length };
}

async function deleteExperimentalRows(client: SupabaseClient, campaignId: string): Promise<void> {
  for (const table of ['results', 'campaign_reports'] as const) {
    const { error } = await client
      .from(table)
      .delete()
      .eq('campaign_id', campaignId)
      .eq('source', EXPERIMENTAL_REPORT_SOURCE);
    if (error) throw new Error(`Could not clear the earlier ${table} rows: ${error.message}`);
  }
}
