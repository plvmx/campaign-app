/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Fills derived state/location/leader on `campaign_reports` rows. Takes an
 * injected client (always `supabaseAdmin` in practice — the table has no
 * authenticated write policy) so it can be unit tested with supabaseMock.ts.
 * (The live Google Sheet sync that used to share this file was removed once
 * the app's own report page replaced the sheet.)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deriveCampaignReportFields, locationKey, type PlaceRef, type LeaderRef, type LocationAliasRef,
} from '@/lib/campaignReportMatcher';

/** Derive state/location/leader for the whole history (the original 2026-05-06 cutoff was lifted 2026-10-24). */
export const DERIVE_SINCE = '2000-01-01';

export interface DeriveResult {
  inScope: number;
  updated: number;
  /** Rows still without a state. */
  unresolved: number;
  /** Rows still without a mapped location, and how many distinct typed spellings that is. */
  noLocationRows: number;
  noLocationSpellings: number;
}

const PAGE = 1000;
const UPDATE_CHUNK = 100; // ids per UPDATE ... IN (...) — keeps the request URL short

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

/** Confirmed location aliases keyed by location_key. A missing table (SQL not yet run) counts as none. */
export async function loadLocationAliases(client: SupabaseClient): Promise<Map<string, LocationAliasRef>> {
  const { data, error } = await client.from('campaign_report_location_aliases').select('location_key, state, location');
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703' || code === 'PGRST205') return new Map();
    throw error;
  }
  return new Map((data ?? []).map((a) => [a.location_key as string, a as LocationAliasRef]));
}

interface ReportForDerive {
  id: string;
  location_raw: string | null;
  leader_raw: string | null;
  derived_state: string | null;
  derived_location: string | null;
  derived_leader: string | null;
}

/**
 * Fills derived_state/derived_location/derived_leader for every row from
 * `since` on. By default only EMPTY fields are filled, so a value an admin
 * set by hand (Campaign Reports screen) or a location alias already applied is never
 * overwritten by a later run; `overwrite: true` recomputes everything (used
 * once after the matcher itself changes). Rows needing the same values are
 * written together. Also reports how many rows still have no location.
 */
export async function deriveCampaignReportFieldsSince(
  client: SupabaseClient,
  since: string = DERIVE_SINCE,
  apply = true,
  overwrite = false,
): Promise<DeriveResult> {
  const reports = await fetchAll<ReportForDerive>((from, to) =>
    client.from('campaign_reports')
      .select('id, location_raw, leader_raw, derived_state, derived_location, derived_leader')
      .gte('submitted_at', since).order('submitted_at').range(from, to));
  const { data: places, error: pErr } = await client.from('state_places').select('state, place, location');
  if (pErr) throw pErr;
  const { data: leaders, error: lErr } = await client.from('state_leaders').select('state, leader');
  if (lErr) throw lErr;
  const aliases = await loadLocationAliases(client);

  const groups = new Map<string, { values: Record<string, string | null>; ids: string[] }>();
  let updated = 0;
  let unresolved = 0;
  let noLocationRows = 0;
  const noLocationKeys = new Set<string>();

  for (const row of reports) {
    const d = deriveCampaignReportFields(row, (places ?? []) as PlaceRef[], (leaders ?? []) as LeaderRef[], aliases);
    const next = {
      derived_state: overwrite ? d.state : row.derived_state ?? d.state,
      derived_location: overwrite ? d.location : row.derived_location ?? d.location,
      derived_leader: overwrite ? d.leader : row.derived_leader ?? d.leader,
    };
    if (!next.derived_state) unresolved++;
    if (!next.derived_location) {
      noLocationRows++;
      noLocationKeys.add(locationKey(row.location_raw));
    }
    if (next.derived_state === row.derived_state && next.derived_location === row.derived_location && next.derived_leader === row.derived_leader) continue;
    updated++;
    const groupKey = JSON.stringify(next);
    const g: { values: Record<string, string | null>; ids: string[] } = groups.get(groupKey) ?? { values: next, ids: [] };
    g.ids.push(row.id);
    groups.set(groupKey, g);
  }

  if (apply) {
    for (const { values, ids } of groups.values()) {
      for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
        const { error } = await client.from('campaign_reports').update(values).in('id', ids.slice(i, i + UPDATE_CHUNK));
        if (error) throw error;
      }
    }
  }
  return { inScope: reports.length, updated, unresolved, noLocationRows, noLocationSpellings: noLocationKeys.size };
}
