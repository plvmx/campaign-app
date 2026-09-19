/**
 * Pure map-assembly logic for the public "Upcoming Campaigns" map
 * (app/public/upcoming-campaigns, app/api/public/upcoming-campaigns/route.ts)
 * — the general-public counterpart to lib/services/campaignMapService.ts's
 * admin `getMapData`. Deliberately narrower, same reasoning as
 * publicCampaignsNearMeService.ts: this only ever uses cached state_places
 * coordinates (no on-demand Nominatim geocoding, which needs the
 * admin-only /api/admin/geocode-place route an anonymous visitor can't
 * call), and takes already-fetched rows rather than calling Supabase
 * itself, so the grouping logic is testable with no mocks. Unlike
 * publicCampaignsNearMeService's buildNearbyMarkers, there is no
 * centre/radius — every upcoming campaign in the given rows is grouped
 * into a marker, since this map shows all states at once rather than a
 * distance-filtered view.
 */
import { placeKey } from './campaignMapService';

export interface PublicUpcomingCampaignRow {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  category: string | null;
}

export interface PublicUpcomingPlaceCoords {
  state: string;
  place: string;
  latitude: number;
  longitude: number;
}

export interface PublicUpcomingCampaign {
  id: string;
  date: string;
  time: string;
  leader: string;
  category: string | null;
}

export interface PublicUpcomingMarker {
  state: string;
  place: string;
  latitude: number;
  longitude: number;
  campaigns: PublicUpcomingCampaign[];
}

export interface BuildUpcomingMarkersResult {
  markers: PublicUpcomingMarker[];
  /** Distinct places with at least one campaign in range but no cached coordinates. */
  unresolvedCount: number;
}

/**
 * Groups already-upcoming, in-window campaigns by place and resolves each
 * place's coordinates from `placeCoords` (cached state_places rows only).
 * Callers are responsible for having already filtered `campaigns` to the
 * desired date range and excluded past ones (isCampaignPast).
 */
export function buildUpcomingCampaignMarkers(
  campaigns: PublicUpcomingCampaignRow[],
  placeCoords: PublicUpcomingPlaceCoords[],
): BuildUpcomingMarkersResult {
  const coordsByKey = new Map(placeCoords.map((p) => [placeKey(p.state, p.place), p]));

  const grouped = new Map<string, { state: string; place: string; campaigns: PublicUpcomingCampaign[] }>();
  for (const c of campaigns) {
    const key = placeKey(c.state, c.place);
    const entry: PublicUpcomingCampaign = { id: c.id, date: c.date, time: c.time, leader: c.leader, category: c.category };
    const group = grouped.get(key);
    if (group) {
      group.campaigns.push(entry);
    } else {
      grouped.set(key, { state: c.state, place: c.place, campaigns: [entry] });
    }
  }

  const markers: PublicUpcomingMarker[] = [];
  let unresolvedCount = 0;
  for (const [key, group] of grouped) {
    const coords = coordsByKey.get(key);
    if (!coords) {
      unresolvedCount++;
      continue;
    }
    markers.push({ ...group, latitude: coords.latitude, longitude: coords.longitude });
  }

  return { markers, unresolvedCount };
}
