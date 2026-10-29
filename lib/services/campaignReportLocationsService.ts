/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Backs /admin/campaign-report-locations: lists the typed sheet locations that
 * don't yet map to a State Places location, and records an admin's decision as
 * a campaign_report_location_aliases row (adding a historical-only location to
 * state_places when asked). Server-side only — injected client, always
 * `supabaseAdmin` (these tables have no authenticated write policy).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { locationKey, locationOf, type PlaceRef } from '@/lib/campaignReportMatcher';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import { ensureStateLocation, toStateLocations, type StateLocation } from '@/lib/services/stateLocations';

const PAGE = 1000;
const UPDATE_CHUNK = 100;

export interface UnresolvedLocation {
  key: string;
  /** The spelling used most often for this key, for display. */
  example: string;
  rows: number;
  /** The state already derived for these rows, when they all agree. */
  knownState: string | null;
  suggestions: StateLocation[];
}

export interface UnresolvedLocationsResult {
  /** Typed spellings with no mapped location yet, most records first. */
  spellings: UnresolvedLocation[];
  /** Every physical location (`state_places.location`) a spelling can be mapped to. */
  locations: StateLocation[];
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Locations whose name — or the name of a State Places row that sits at them —
 * appears inside the typed text (or starts with it): a hint for the admin,
 * never applied automatically.
 */
export function suggestLocations(key: string, places: PlaceRef[], knownState: string | null): StateLocation[] {
  const padded = ` ${norm(key)} `;
  const out = new Map<string, StateLocation>();
  for (const p of places) {
    if (knownState && p.state !== knownState) continue;
    const location = locationOf(p);
    const hit = [p.place, location].some((n) => {
      const name = norm(n);
      return name.length >= 3 && (padded.includes(` ${name} `) || name.startsWith(`${padded.trim()} `));
    });
    if (hit) out.set(`${p.state}|${location.toLowerCase()}`, { state: p.state, location });
  }
  return [...out.values()].slice(0, 4);
}

export async function getUnresolvedLocations(client: SupabaseClient): Promise<UnresolvedLocationsResult> {
  const rows = await fetchAll<{ location_raw: string | null; derived_state: string | null }>((from, to) =>
    client.from('campaign_reports').select('location_raw, derived_state').is('derived_location', null).order('submitted_at').range(from, to));
  const { data, error } = await client.from('state_places').select('state, place, location').order('state').order('place');
  if (error) throw error;
  const places = (data ?? []) as PlaceRef[];

  const groups = new Map<string, { spellings: Map<string, number>; rows: number; states: Set<string | null> }>();
  for (const r of rows) {
    const key = locationKey(r.location_raw);
    if (!key) continue;
    const g = groups.get(key) ?? { spellings: new Map(), rows: 0, states: new Set() };
    g.rows++;
    g.states.add(r.derived_state);
    const spelling = (r.location_raw ?? '').trim();
    g.spellings.set(spelling, (g.spellings.get(spelling) ?? 0) + 1);
    groups.set(key, g);
  }

  const spellings = [...groups.entries()].map(([key, g]) => {
    const knownState = g.states.size === 1 ? [...g.states][0] : null;
    const example = [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { key, example, rows: g.rows, knownState, suggestions: suggestLocations(key, places, knownState) };
  }).sort((a, b) => b.rows - a.rows);

  return { spellings, locations: toStateLocations(places) };
}

export type SaveAliasResult = { ok: true; rowsUpdated: number } | { ok: false; status: number; error: string };

/**
 * Records "this typed spelling means <state> / <location>" and applies it to
 * every report with that spelling. `newLocation` adds a historical-only
 * location to State Places first; otherwise `location` must already be a
 * location in that state (or null to record the state alone).
 */
export async function saveLocationAlias(
  client: SupabaseClient,
  input: { locationKey: string; state: string; location: string | null; newLocation: string | null },
): Promise<SaveAliasResult> {
  const key = input.locationKey.trim().toLowerCase();
  if (!key) return { ok: false, status: 400, error: 'Missing location' };
  if (!AUSTRALIAN_STATES.includes(input.state as never)) return { ok: false, status: 400, error: `Invalid state: ${input.state}` };

  let location: string | null = null;
  const wanted = (input.newLocation ?? input.location)?.trim();
  if (wanted) {
    const result = await ensureStateLocation(client, input.state, wanted, Boolean(input.newLocation?.trim()));
    if (!result.ok) return { ok: false, status: 400, error: result.error };
    location = result.location;
  }

  const { error: aliasError } = await client
    .from('campaign_report_location_aliases')
    .upsert({ location_key: key, state: input.state, location }, { onConflict: 'location_key' });
  if (aliasError) throw aliasError;

  const reports = await fetchAll<{ id: string; location_raw: string | null }>((from, to) =>
    client.from('campaign_reports').select('id, location_raw').order('submitted_at').range(from, to));
  const ids = reports.filter((r) => locationKey(r.location_raw) === key).map((r) => r.id);
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const { error } = await client
      .from('campaign_reports')
      .update({ derived_state: input.state, derived_location: location })
      .in('id', ids.slice(i, i + UPDATE_CHUNK));
    if (error) throw error;
  }
  return { ok: true, rowsUpdated: ids.length };
}
