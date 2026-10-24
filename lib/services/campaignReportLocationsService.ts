/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Backs /admin/campaign-report-locations: lists the sheet locations that
 * don't yet map to a state_places place, and records an admin's decision as a
 * campaign_report_location_aliases row (adding a historical-only place to
 * state_places when asked). Server-side only — injected client, always
 * `supabaseAdmin` (these tables have no authenticated write policy).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { locationKey } from '@/lib/campaignReportMatcher';
import { AUSTRALIAN_STATES } from '@/lib/constants';

const PAGE = 1000;
const UPDATE_CHUNK = 100;

export interface UnresolvedLocation {
  key: string;
  /** The spelling used most often for this key, for display. */
  example: string;
  rows: number;
  /** The state already derived for these rows, when they all agree. */
  knownState: string | null;
  suggestions: { state: string; place: string }[];
}

export interface UnresolvedLocationsResult {
  locations: UnresolvedLocation[];
  places: { state: string; place: string }[];
}

interface PlaceRow { state: string; place: string }

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

/** state_places entries whose name appears inside the location text (or contains it) — a hint for the admin, never applied automatically. */
export function suggestPlaces(key: string, places: PlaceRow[], knownState: string | null): PlaceRow[] {
  const padded = ` ${key.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const found = places.filter((p) => {
    if (knownState && p.state !== knownState) return false;
    const name = p.place.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (name.length < 3) return false;
    return padded.includes(` ${name} `) || name.startsWith(`${padded.trim()} `);
  });
  return found.slice(0, 4);
}

export async function getUnresolvedLocations(client: SupabaseClient): Promise<UnresolvedLocationsResult> {
  const rows = await fetchAll<{ location_raw: string | null; derived_state: string | null }>((from, to) =>
    client.from('campaign_reports').select('location_raw, derived_state').is('derived_place', null).order('submitted_at').range(from, to));
  const { data: places, error } = await client.from('state_places').select('state, place').order('state').order('place');
  if (error) throw error;

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

  const locations = [...groups.entries()].map(([key, g]) => {
    const knownState = g.states.size === 1 ? [...g.states][0] : null;
    const example = [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { key, example, rows: g.rows, knownState, suggestions: suggestPlaces(key, places ?? [], knownState) };
  }).sort((a, b) => b.rows - a.rows);

  return { locations, places: places ?? [] };
}

export type SaveAliasResult = { ok: true; rowsUpdated: number } | { ok: false; status: number; error: string };

/**
 * Records "this spelling means <state> / <place>" and applies it to every
 * report with that spelling. `newPlace` adds a historical-only place to
 * state_places first; otherwise `place` must already be in state_places for
 * that state (or null to record the state alone).
 */
export async function saveLocationAlias(
  client: SupabaseClient,
  input: { locationKey: string; state: string; place: string | null; newPlace: string | null },
): Promise<SaveAliasResult> {
  const key = input.locationKey.trim().toLowerCase();
  if (!key) return { ok: false, status: 400, error: 'Missing location' };
  if (!AUSTRALIAN_STATES.includes(input.state as never)) return { ok: false, status: 400, error: `Invalid state: ${input.state}` };

  let place = input.place?.trim() || null;
  const newPlace = input.newPlace?.trim() || null;

  if (newPlace) {
    const { error } = await client.from('state_places').insert([{ state: input.state, place: newPlace }]);
    if (error && error.code !== '23505') throw error;
    place = newPlace;
  } else if (place) {
    const { data, error } = await client.from('state_places').select('place').eq('state', input.state).eq('place', place).limit(1);
    if (error) throw error;
    if (!data?.length) return { ok: false, status: 400, error: `"${place}" is not a ${input.state} place` };
  }

  const { error: aliasError } = await client
    .from('campaign_report_location_aliases')
    .upsert({ location_key: key, state: input.state, place }, { onConflict: 'location_key' });
  if (aliasError) throw aliasError;

  const reports = await fetchAll<{ id: string; location_raw: string | null }>((from, to) =>
    client.from('campaign_reports').select('id, location_raw').order('submitted_at').range(from, to));
  const ids = reports.filter((r) => locationKey(r.location_raw) === key).map((r) => r.id);
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const { error } = await client
      .from('campaign_reports')
      .update({ derived_state: input.state, derived_place: place })
      .in('id', ids.slice(i, i + UPDATE_CHUNK));
    if (error) throw error;
  }
  return { ok: true, rowsUpdated: ids.length };
}
