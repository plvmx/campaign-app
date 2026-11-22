/**
 * The one place that decides what a freshly created `state_places` row looks
 * like, whichever screen creates it (a leader typing a new place in a
 * campaign form, or an admin adding a historical place from the Campaign
 * Reports screens). Every new place gets its `location` text (the query an
 * admin can re-run from /admin/state-places) and, when Nominatim finds it
 * *inside the right state*, coordinates — without these a place is invisible
 * on the public maps, which never geocode on demand.
 */
import { geocodePlace, type GeocodeResult } from '@/lib/geocoding';
import { isWithinState } from '@/lib/stateBounds';

export interface NewStatePlaceRow {
  state: string;
  place: string;
  location: string;
  latitude?: number;
  longitude?: number;
}

export async function buildNewStatePlaceRow(
  state: string,
  place: string,
  geocode: (place: string, state: string) => Promise<GeocodeResult | null> = geocodePlace,
): Promise<NewStatePlaceRow> {
  const normalizedState = state.toUpperCase().trim();
  const normalizedPlace = place.trim();
  const row: NewStatePlaceRow = { state: normalizedState, place: normalizedPlace, location: normalizedPlace };

  const found = await geocode(normalizedPlace, normalizedState).catch(() => null);
  if (found && isWithinState(found.latitude, found.longitude, normalizedState)) {
    row.latitude = found.latitude;
    row.longitude = found.longitude;
  }
  return row;
}
