/**
 * Builds map-ready data for the admin campaign map: campaigns within a date range
 * (optionally filtered by state), grouped by place, with coordinates resolved via
 * cached state_places columns or on-demand geocoding through the admin API route.
 */
import { supabase } from '@/lib/supabaseClient';
import { getCampaignsByDateRange } from '@/lib/services/campaignService';
import { getStatePlaces } from '@/lib/services/statePlacesService';
import type { Campaign } from '@/lib/types';

export interface MapMarker {
  state: string;
  place: string;
  latitude: number;
  longitude: number;
  campaigns: Campaign[];
}

export interface MapDataResult {
  markers: MapMarker[];
  /** Places that could not be geocoded — surfaced so the admin knows coverage is incomplete. */
  unresolvedPlaces: { state: string; place: string }[];
}

// campaigns.place and state_places.place are independently free-typed and can differ by
// incidental whitespace/case (e.g. "Preston" vs "Preston "), so cache keys are normalized
// to avoid silently missing an already-geocoded place.
function placeKey(state: string, place: string): string {
  return `${state.trim().toUpperCase()}::${place.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

async function fetchCoordinates(state: string, place: string): Promise<{ latitude: number; longitude: number } | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const response = await fetch('/api/admin/geocode-place', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ state, place }),
    // Guards against a slow geocode (e.g. an unreachable Nominatim) hanging the map indefinitely.
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response || !response.ok) return null;

  const data = await response.json() as { latitude: number; longitude: number };
  return data;
}

export async function getMapData(options: {
  startDate: string;
  endDate: string;
  state?: string;
}): Promise<MapDataResult> {
  const campaigns = await getCampaignsByDateRange(options);

  const grouped = new Map<string, { state: string; place: string; campaigns: Campaign[] }>();
  for (const campaign of campaigns) {
    const key = placeKey(campaign.state, campaign.place);
    const group = grouped.get(key);
    if (group) {
      group.campaigns.push(campaign);
    } else {
      grouped.set(key, { state: campaign.state, place: campaign.place, campaigns: [campaign] });
    }
  }

  const knownPlaces = await getStatePlaces(options.state);
  const coordsByKey = new Map(
    knownPlaces
      .filter(p => p.latitude != null && p.longitude != null)
      .map(p => [placeKey(p.state, p.place), { latitude: p.latitude as number, longitude: p.longitude as number }]),
  );

  const markers: MapMarker[] = [];
  const unresolvedPlaces: { state: string; place: string }[] = [];

  let isFirstUncachedLookup = true;
  for (const [key, group] of grouped) {
    let coords = coordsByKey.get(key);
    if (!coords) {
      // Nominatim's usage policy caps requests at 1/sec — space out uncached lookups
      // so a burst of new places doesn't get throttled into spurious "not found" results.
      if (!isFirstUncachedLookup) await new Promise(resolve => setTimeout(resolve, 1100));
      isFirstUncachedLookup = false;
      coords = await fetchCoordinates(group.state, group.place) ?? undefined;
    }
    if (coords) {
      markers.push({ state: group.state, place: group.place, latitude: coords.latitude, longitude: coords.longitude, campaigns: group.campaigns });
    } else {
      unresolvedPlaces.push({ state: group.state, place: group.place });
    }
  }

  return { markers, unresolvedPlaces };
}
