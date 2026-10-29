/**
 * The physical locations (`state_places.location`) available in each state —
 * what a Campaign Report's "Location" is chosen from. Several State Places
 * rows can share one location ("Perth CBD 1…4" are all "Perth CBD"), so this
 * is the distinct set, not the rows. Server-side: injected client, always
 * `supabaseAdmin`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { distinctLocations, locationOf, type PlaceRef } from '@/lib/campaignReportMatcher';
import { buildNewStatePlaceRow } from '@/lib/services/newStatePlace';

export interface StateLocation {
  state: string;
  location: string;
}

/** Distinct locations per state, sorted by state then name. */
export function toStateLocations(rows: PlaceRef[]): StateLocation[] {
  const byState = new Map<string, PlaceRef[]>();
  for (const r of rows) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  return [...byState.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([state, list]) =>
      distinctLocations(list).sort((a, b) => a.localeCompare(b)).map((location) => ({ state, location })));
}

export async function getStateLocations(client: SupabaseClient): Promise<StateLocation[]> {
  const { data, error } = await client.from('state_places').select('state, place, location');
  if (error) throw error;
  return toStateLocations((data ?? []) as PlaceRef[]);
}

export type EnsureLocationResult =
  | { ok: true; location: string }
  | { ok: false; code: 'unknown_location'; error: string };

/**
 * Confirms `wanted` is a location in `state` (case-insensitively, returning
 * the stored spelling). When it isn't: with `addIfMissing` a new State Places
 * row is created for it (place and location both the new name, geocoded — see
 * newStatePlace.ts); without, it reports `unknown_location` so the caller can
 * ask first.
 */
export async function ensureStateLocation(
  client: SupabaseClient,
  state: string,
  wanted: string,
  addIfMissing: boolean,
): Promise<EnsureLocationResult> {
  const { data, error } = await client.from('state_places').select('state, place, location').eq('state', state);
  if (error) throw error;
  const rows = (data ?? []) as PlaceRef[];
  const existing = distinctLocations(rows).find((l) => l.toLowerCase() === wanted.trim().toLowerCase());
  if (existing) return { ok: true, location: existing };

  if (!addIfMissing) {
    return { ok: false, code: 'unknown_location', error: `"${wanted}" is not a location in State Places for ${state}` };
  }
  const name = wanted.trim();
  // A State Places row already *named* this but located elsewhere (place "Campbelltown", location "Sydney"):
  // adding another row would collide on state+place, and silently reusing it would pick the wrong location.
  const clash = rows.find((r) => r.place.trim().toLowerCase() === name.toLowerCase());
  if (clash) {
    return {
      ok: false, code: 'unknown_location',
      error: `"${name}" is already a place in ${state} whose location is "${locationOf(clash)}" — choose that location, or change it in State Places`,
    };
  }
  const { error: insertError } = await client.from('state_places').insert([await buildNewStatePlaceRow(state, name)]);
  if (insertError && insertError.code !== '23505') throw insertError;
  return { ok: true, location: name };
}
