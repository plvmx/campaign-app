/**
 * Data fetching + aggregation for the Results Metrics admin dashboard
 * (app/admin/results-metrics/page.tsx). Mirrors the join pattern used by
 * lib/reportGenerator.ts: fetch campaigns in a date range, then fetch their
 * results, and stitch them together client-side.
 *
 * `IR` (Information Request) rows are dropped, matching the existing
 * results-report convention (see generate-report/page.tsx).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { combinePlaceAndSite } from '@/lib/placeSite';

export type ResultCategory = 'TM' | 'P' | 'F' | 'SP';

export const RESULT_CATEGORIES: ResultCategory[] = ['TM', 'P', 'F', 'SP'];

export const RESULT_CATEGORY_LABELS: Record<ResultCategory, string> = {
  TM: 'Team Members',
  P: 'Partial Presentations',
  F: 'Full Presentations',
  SP: 'Full Presentations + Sinner’s Prayer',
};

function emptyCategoryNames(): Record<ResultCategory, string[]> {
  return { TM: [], P: [], F: [], SP: [] };
}

function emptyCategoryCounts(): Record<ResultCategory, number> {
  return { TM: 0, P: 0, F: 0, SP: 0 };
}

interface RawCampaign {
  id: string;
  date: string;
  state: string;
  place: string;
  site: string;
  leader: string;
  actual_leader: string | null;
}

interface RawResult {
  campaign_id: string;
  first_name: string;
  category_code: string;
}

export interface CampaignResultsRow {
  campaignId: string;
  date: string;
  state: string;
  place: string;
  leader: string;
  actualLeader: string | null;
  names: Record<ResultCategory, string[]>;
}

/**
 * Fetches every campaign in [startDate, endDate] and attaches its recorded
 * result names, grouped by category. One row per campaign, always present
 * even when it has zero recorded results (so "no results yet" is visible).
 */
export async function fetchResultsMetrics(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<CampaignResultsRow[]> {
  const { data: campaigns, error: campaignsError } = await supabase
    .from('campaigns')
    .select('id, date, state, place, site, leader, actual_leader')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('state', { ascending: true })
    .order('place', { ascending: true });
  if (campaignsError) throw campaignsError;

  const campaignRows = (campaigns ?? []) as RawCampaign[];
  if (campaignRows.length === 0) return [];

  const campaignIds = campaignRows.map((c) => c.id);
  const { data: results, error: resultsError } = await supabase
    .from('results')
    .select('campaign_id, first_name, category_code')
    .in('campaign_id', campaignIds);
  if (resultsError) throw resultsError;

  const resultsByCampaign = new Map<string, RawResult[]>();
  for (const r of (results ?? []) as RawResult[]) {
    if (!resultsByCampaign.has(r.campaign_id)) resultsByCampaign.set(r.campaign_id, []);
    resultsByCampaign.get(r.campaign_id)!.push(r);
  }

  return campaignRows.map((c) => {
    const names = emptyCategoryNames();
    for (const r of resultsByCampaign.get(c.id) ?? []) {
      if (r.category_code in names) names[r.category_code as ResultCategory].push(r.first_name);
    }
    return {
      campaignId: c.id,
      date: c.date,
      state: c.state,
      place: combinePlaceAndSite(c.place, c.site),
      leader: c.leader,
      actualLeader: c.actual_leader,
      names,
    };
  });
}

// ---------------------------------------------------------------------------
// Pure aggregations (no I/O — easy to unit test directly)
// ---------------------------------------------------------------------------

export interface CategoryTotal {
  category: ResultCategory;
  count: number;
}

export function aggregateByCategory(rows: CampaignResultsRow[]): CategoryTotal[] {
  return RESULT_CATEGORIES.map((category) => ({
    category,
    count: rows.reduce((sum, r) => sum + r.names[category].length, 0),
  }));
}

export interface StateResultsTotal {
  state: string;
  campaigns: number;
  totals: Record<ResultCategory, number>;
  total: number;
}

export function aggregateByState(rows: CampaignResultsRow[]): StateResultsTotal[] {
  const map = new Map<string, StateResultsTotal>();
  for (const row of rows) {
    let entry = map.get(row.state);
    if (!entry) {
      entry = { state: row.state, campaigns: 0, totals: emptyCategoryCounts(), total: 0 };
      map.set(row.state, entry);
    }
    entry.campaigns += 1;
    for (const category of RESULT_CATEGORIES) {
      const n = row.names[category].length;
      entry.totals[category] += n;
      entry.total += n;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export interface PersonResultsTotal {
  /** Display name, using the casing of the first occurrence encountered. */
  name: string;
  totals: Record<ResultCategory, number>;
  total: number;
}

/**
 * Leaderboard of recorded names across all categories. `first_name` is
 * free text (no foreign key to state_leaders), so entries are grouped by
 * trimmed, case-insensitive match — typos/variants will still fragment a
 * person's totals.
 */
export function aggregateByPerson(rows: CampaignResultsRow[]): PersonResultsTotal[] {
  const map = new Map<string, PersonResultsTotal>();
  for (const row of rows) {
    for (const category of RESULT_CATEGORIES) {
      for (const rawName of row.names[category]) {
        const name = rawName.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        let entry = map.get(key);
        if (!entry) {
          entry = { name, totals: emptyCategoryCounts(), total: 0 };
          map.set(key, entry);
        }
        entry.totals[category] += 1;
        entry.total += 1;
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}
