/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Temporary bridge: keeps `campaign_reports` current from the live Google
 * Sheet until the app's own campaign-report numbers replace it. Takes an
 * injected client (always `supabaseAdmin` in practice — the table has no
 * authenticated write policy) so it can be unit tested with supabaseMock.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCampaignReportRow, type CampaignReportInsert, type RawCampaignReportSheetRow } from '@/lib/campaignReportParser';
import { deriveCampaignReportFields, type PlaceRef, type LeaderRef } from '@/lib/campaignReportMatcher';
import { fetchCampaignReportSheetRows } from '@/lib/campaignReportSheetReader';

/** Rows from this date on get derived_state/place/leader (the project's narrowed scope). */
export const DERIVE_SINCE = '2026-05-06';

/** Marks rows written by the live sync so they're easy to find (and remove) when the sheet is retired. */
export const SHEET_SYNC_SOURCE = 'google_sheet_sync';

const BATCH_SIZE = 500;

export interface SheetSyncResult {
  sheetRows: number;
  skippedNoTimestamp: number;
  duplicateTimestampsInSheet: number;
  inserted: number;
  alreadyPresent: number;
  needsReview: number;
  derived: DeriveResult;
}

export interface DeriveResult {
  inScope: number;
  updated: number;
  unresolved: number;
}

/** Normalizes raw sheet rows, dropping rows with no usable timestamp and repeated timestamps (first wins, like the original load). */
export function prepareInserts(rows: RawCampaignReportSheetRow[]): {
  inserts: CampaignReportInsert[]; skippedNoTimestamp: number; duplicateTimestamps: number;
} {
  const seen = new Set<string>();
  const inserts: CampaignReportInsert[] = [];
  let skippedNoTimestamp = 0;
  let duplicateTimestamps = 0;
  for (const raw of rows) {
    const normalized = normalizeCampaignReportRow(raw);
    if (!normalized) { skippedNoTimestamp++; continue; }
    if (seen.has(normalized.submitted_at)) { duplicateTimestamps++; continue; }
    seen.add(normalized.submitted_at);
    inserts.push({ ...normalized, source: SHEET_SYNC_SOURCE });
  }
  return { inserts, skippedNoTimestamp, duplicateTimestamps };
}

/**
 * Recomputes derived_state/place/leader for rows submitted since `since` and
 * writes only those whose values changed. Idempotent.
 */
export async function deriveCampaignReportFieldsSince(
  client: SupabaseClient,
  since: string = DERIVE_SINCE,
  apply = true,
): Promise<DeriveResult> {
  const { data: reports, error: rErr } = await client
    .from('campaign_reports')
    .select('id, location_raw, leader_raw, derived_state, derived_place, derived_leader')
    .gte('submitted_at', since);
  if (rErr) throw rErr;
  const { data: places, error: pErr } = await client.from('state_places').select('state, place');
  if (pErr) throw pErr;
  const { data: leaders, error: lErr } = await client.from('state_leaders').select('state, leader');
  if (lErr) throw lErr;

  let updated = 0;
  let unresolved = 0;
  for (const row of reports ?? []) {
    const derived = deriveCampaignReportFields(row, (places ?? []) as PlaceRef[], (leaders ?? []) as LeaderRef[]);
    if (!derived.state) unresolved++;
    const changed =
      (row.derived_state ?? null) !== derived.state ||
      (row.derived_place ?? null) !== derived.place ||
      (row.derived_leader ?? null) !== derived.leader;
    if (!changed) continue;
    updated++;
    if (apply) {
      const { error } = await client
        .from('campaign_reports')
        .update({ derived_state: derived.state, derived_place: derived.place, derived_leader: derived.leader })
        .eq('id', row.id);
      if (error) throw error;
    }
  }
  return { inScope: reports?.length ?? 0, updated, unresolved };
}

/** Every `submitted_at` already stored, as epoch ms (dry runs use this to count what would be new). */
async function loadExistingTimestamps(client: SupabaseClient): Promise<Set<number>> {
  const PAGE = 1000;
  const keys = new Set<number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('campaign_reports').select('submitted_at').order('submitted_at').range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) keys.add(new Date(r.submitted_at as string).getTime());
    if ((data?.length ?? 0) < PAGE) return keys;
  }
}

/**
 * Pulls the sheet and inserts rows not yet in `campaign_reports` (matched on
 * the unique `submitted_at`; existing rows are never modified, so any manual
 * cleanup of them survives), then derives state/place/leader for recent rows.
 * With `apply: false` nothing is written.
 */
export async function syncCampaignReportsFromSheet(
  client: SupabaseClient,
  sheetId: string,
  options: { apply?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<SheetSyncResult> {
  const apply = options.apply ?? true;
  const rawRows = await fetchCampaignReportSheetRows(sheetId, options.fetchImpl);
  const { inserts, skippedNoTimestamp, duplicateTimestamps } = prepareInserts(rawRows);

  let inserted = 0;
  if (!apply) {
    const existing = await loadExistingTimestamps(client);
    inserted = inserts.filter((r) => !existing.has(new Date(r.submitted_at).getTime())).length;
  } else {
    for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
      const { data, error } = await client
        .from('campaign_reports')
        .upsert(inserts.slice(i, i + BATCH_SIZE), { onConflict: 'submitted_at', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      inserted += data?.length ?? 0;
    }
  }

  const derived = await deriveCampaignReportFieldsSince(client, DERIVE_SINCE, apply);

  return {
    sheetRows: rawRows.length,
    skippedNoTimestamp,
    duplicateTimestampsInSheet: duplicateTimestamps,
    inserted,
    alreadyPresent: inserts.length - inserted,
    needsReview: inserts.filter((r) => r.needs_review).length,
    derived,
  };
}
