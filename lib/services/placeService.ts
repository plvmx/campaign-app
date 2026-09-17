import { supabase } from '@/lib/supabaseClient';
import { geocodePlace } from '@/lib/geocoding';

/**
 * Insert a new place for the given state. Silently ignores duplicate (23505).
 *
 * Best-effort geocodes the place immediately, using the place name itself
 * as the location text — this call site (a leader typing a brand-new place
 * inline while creating a campaign, via useCampaignForm.ts) has no separate
 * "location" field the way the admin Manage State Places page does, so
 * without this a new place silently lands with no coordinates at all. The
 * public Campaigns Near Me map never geocodes on demand (only cached
 * state_places coordinates — see publicCampaignsNearMeService.ts), so an
 * ungeocoded place is invisible there with no warning until someone
 * notices a campaign missing from their map (see CLAUDE.md's 2026-09-17
 * "state_places geocoding gap" entry for the incident this prevents).
 * Most everyday place names (a suburb/town) geocode fine as-is; a venue or
 * event name that doesn't is left ungeocoded exactly as before — an admin
 * can fix it via Manage State Places, which now flags any place missing
 * coordinates regardless of cause.
 */
export async function addNewPlaceForState(state: string, place: string): Promise<void> {
  const normalizedState = state.toUpperCase().trim();
  const normalizedPlace = place.trim();

  const geocoded = await geocodePlace(normalizedPlace, normalizedState);
  const row = geocoded
    ? { state: normalizedState, place: normalizedPlace, location: normalizedPlace, latitude: geocoded.latitude, longitude: geocoded.longitude }
    : { state: normalizedState, place: normalizedPlace };

  const { error } = await supabase.from('state_places').insert([row]);
  if (error && error.code !== '23505')
    throw new Error(`Failed to add new place: ${error.message}`);
}
