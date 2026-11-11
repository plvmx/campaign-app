import type { SupabaseClient } from '@supabase/supabase-js';
import { parseDeviceId, summariseVisits, type LegacyReportVisitRow, type LegacyReportVisitSummary } from '@/lib/legacyReportVisits';

/** Records one visit to the "campaign reporting has moved" page. Injected client (always `supabaseAdmin`). Throws on a database error. */
export async function recordLegacyReportVisit(client: SupabaseClient, rawDeviceId: unknown): Promise<void> {
  const { error } = await client.from('legacy_report_visits').insert({ device_id: parseDeviceId(rawDeviceId) });
  if (error) throw new Error(error.message || 'Could not record the visit');
}

const PAGE = 1000;

/** Counts of visits for the admin card. Reads every row (low volume), a page at a time. */
export async function getLegacyReportVisitSummary(client: SupabaseClient, now: number = Date.now()): Promise<LegacyReportVisitSummary> {
  const rows: LegacyReportVisitRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('legacy_report_visits')
      .select('visited_at, device_id')
      .order('visited_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || 'Could not load the visits');
    const page = (data ?? []) as LegacyReportVisitRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return summariseVisits(rows, now);
}
