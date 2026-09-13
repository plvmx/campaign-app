/**
 * Pure map-assembly logic for the public "Campaigns Near Me" screen a
 * registrant reaches from their WhatsApp-invite email
 * (app/public/campaigns-near-me, app/api/public/campaigns-near-me/route.ts).
 *
 * Deliberately narrower than lib/services/nearbyCampaignsService.ts's
 * admin equivalent: this only ever uses cached state_places coordinates
 * (no on-demand Nominatim geocoding of a place — that goes through the
 * admin-only /api/admin/geocode-place route, which an anonymous public
 * visitor can't call), and takes already-fetched rows rather than calling
 * Supabase itself, so the actual grouping/distance/sort logic is testable
 * with no mocks at all. The route handler does the (untested, matching
 * this codebase's convention for /api/public/* handlers) fetching.
 */
import { haversineKm } from './nearbyCampaignsService';
import { placeKey } from './campaignMapService';

export interface PublicNearbyCampaignRow {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  category: string | null;
}

export interface PublicPlaceCoords {
  state: string;
  place: string;
  latitude: number;
  longitude: number;
}

export interface PublicNearbyCampaign {
  id: string;
  date: string;
  time: string;
  leader: string;
  category: string | null;
}

export interface PublicNearbyMarker {
  state: string;
  place: string;
  latitude: number;
  longitude: number;
  /** Straight-line distance from the centre, in km, rounded to one decimal. */
  distanceKm: number;
  campaigns: PublicNearbyCampaign[];
}

/** GET /api/public/campaigns-near-me's full response shape — shared with the page (app/public/campaigns-near-me/page.tsx) since route.ts files can't export anything but HTTP methods/route config. */
export interface CampaignsNearMeResponse {
  firstName: string | null;
  startDate: string;
  endDate: string;
  radiusKm: number;
  /** null when there's no postcode/state to centre a map on, or geocoding that failed — the page shows a fallback message rather than an empty map in that case. */
  center: { latitude: number; longitude: number; label: string } | null;
  markers: PublicNearbyMarker[];
  unresolvedCount: number;
}

export interface BuildNearbyMarkersResult {
  markers: PublicNearbyMarker[];
  /** Distinct places with at least one campaign in range but no cached coordinates. */
  unresolvedCount: number;
}

/**
 * Groups already-upcoming, in-window campaigns by place, resolves each
 * place's coordinates from `placeCoords` (cached state_places rows only),
 * and keeps only those within `radiusKm` of `center` — sorted nearest
 * first. Callers are responsible for having already filtered `campaigns`
 * to the desired date range and excluded past ones (isCampaignPast).
 */
export function buildNearbyMarkers(
  campaigns: PublicNearbyCampaignRow[],
  placeCoords: PublicPlaceCoords[],
  center: { latitude: number; longitude: number },
  radiusKm: number,
): BuildNearbyMarkersResult {
  const coordsByKey = new Map(placeCoords.map((p) => [placeKey(p.state, p.place), p]));

  const grouped = new Map<string, { state: string; place: string; campaigns: PublicNearbyCampaign[] }>();
  for (const c of campaigns) {
    const key = placeKey(c.state, c.place);
    const entry: PublicNearbyCampaign = { id: c.id, date: c.date, time: c.time, leader: c.leader, category: c.category };
    const group = grouped.get(key);
    if (group) {
      group.campaigns.push(entry);
    } else {
      grouped.set(key, { state: c.state, place: c.place, campaigns: [entry] });
    }
  }

  const markers: PublicNearbyMarker[] = [];
  let unresolvedCount = 0;
  for (const [key, group] of grouped) {
    const coords = coordsByKey.get(key);
    if (!coords) {
      unresolvedCount++;
      continue;
    }
    // haversineKm takes {lat, lng} — everything else here uses
    // {latitude, longitude} (matching the campaigns-near-me API response
    // shape), so this is the one spot they're translated.
    const distanceKm = haversineKm(
      { lat: center.latitude, lng: center.longitude },
      { lat: coords.latitude, lng: coords.longitude },
    );
    if (distanceKm <= radiusKm) {
      markers.push({ ...group, latitude: coords.latitude, longitude: coords.longitude, distanceKm: Math.round(distanceKm * 10) / 10 });
    }
  }

  markers.sort((a, b) => a.distanceKm - b.distanceKm);

  return { markers, unresolvedCount };
}
