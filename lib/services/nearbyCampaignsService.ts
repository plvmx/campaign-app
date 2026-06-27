/**
 * Builds map-ready data for the "Campaigns Near Me" screen: campaigns within
 * a date range, filtered to those whose place is within a radius (km) of a
 * given centre point. Reuses the existing getMapData() pipeline so geocoding
 * lookups and the state_places cache are shared with the admin campaign map.
 */
import { getMapData, type MapMarker, type MapDataResult } from '@/lib/services/campaignMapService';

export interface NearbyCampaignsOptions {
  startDate: string;
  endDate: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}

export interface NearbyMapMarker extends MapMarker {
  /** Straight-line distance from the centre, in km, rounded to one decimal. */
  distanceKm: number;
}

export interface NearbyCampaignsResult {
  markers: NearbyMapMarker[];
  unresolvedPlaces: MapDataResult['unresolvedPlaces'];
}

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two lat/lng points using the haversine formula.
 * Accurate to better than 0.5% for distances under a few hundred km, which is well
 * within the precision needed for "campaigns within 60 km".
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export async function getNearbyCampaigns(
  options: NearbyCampaignsOptions,
): Promise<NearbyCampaignsResult> {
  const { centerLat, centerLng, radiusKm, startDate, endDate } = options;

  // No state filter — campaigns within 60 km of a border may straddle two states.
  const { markers, unresolvedPlaces } = await getMapData({ startDate, endDate });

  const center = { lat: centerLat, lng: centerLng };
  const nearby: NearbyMapMarker[] = [];
  for (const marker of markers) {
    const distanceKm = haversineKm(center, { lat: marker.latitude, lng: marker.longitude });
    if (distanceKm <= radiusKm) {
      nearby.push({ ...marker, distanceKm: Math.round(distanceKm * 10) / 10 });
    }
  }

  nearby.sort((a, b) => a.distanceKm - b.distanceKm);

  return { markers: nearby, unresolvedPlaces };
}
