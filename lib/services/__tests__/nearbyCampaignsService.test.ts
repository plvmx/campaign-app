import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/campaignMapService', () => ({
  getMapData: vi.fn(),
}));

import { getMapData } from '@/lib/services/campaignMapService';
import { getNearbyCampaigns, haversineKm } from '../nearbyCampaignsService';
import type { MapMarker } from '../campaignMapService';

const mockGetMapData = vi.mocked(getMapData);

function makeMarker(overrides: Partial<MapMarker> = {}): MapMarker {
  return { state: 'VIC', place: 'Melbourne', site: '', latitude: -37.8136, longitude: 144.9631, campaigns: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm({ lat: -37.8136, lng: 144.9631 }, { lat: -37.8136, lng: 144.9631 })).toBe(0);
  });

  it('computes the known Melbourne-to-Geelong distance to within 2km', () => {
    const melbourne = { lat: -37.8136, lng: 144.9631 };
    const geelong = { lat: -38.1499, lng: 144.3617 };
    const distance = haversineKm(melbourne, geelong);
    expect(distance).toBeGreaterThan(60);
    expect(distance).toBeLessThan(66);
  });
});

describe('getNearbyCampaigns', () => {
  it('does not pass a state filter to getMapData — border campaigns may be in another state', async () => {
    mockGetMapData.mockResolvedValue({ markers: [], unresolvedPlaces: [] });
    await getNearbyCampaigns({ startDate: '2026-01-01', endDate: '2026-01-31', centerLat: -37.8136, centerLng: 144.9631, radiusKm: 60 });
    expect(mockGetMapData).toHaveBeenCalledWith({ startDate: '2026-01-01', endDate: '2026-01-31' });
  });

  it('excludes markers outside the radius and includes those within it', async () => {
    const near = makeMarker({ place: 'Melbourne CBD', latitude: -37.8136, longitude: 144.9631 });
    const far = makeMarker({ place: 'Sydney', latitude: -33.8688, longitude: 151.2093 });
    mockGetMapData.mockResolvedValue({ markers: [near, far], unresolvedPlaces: [] });

    const result = await getNearbyCampaigns({
      startDate: '2026-01-01', endDate: '2026-01-31',
      centerLat: -37.8136, centerLng: 144.9631, radiusKm: 60,
    });

    expect(result.markers).toHaveLength(1);
    expect(result.markers[0].place).toBe('Melbourne CBD');
  });

  it('sorts results by distance ascending and rounds distanceKm to 1 decimal', async () => {
    const center = { lat: -37.8136, lng: 144.9631 };
    const far = makeMarker({ place: 'Geelong', latitude: -38.1499, longitude: 144.3617 });
    const near = makeMarker({ place: 'CBD', latitude: -37.8136, longitude: 144.9631 });
    mockGetMapData.mockResolvedValue({ markers: [far, near], unresolvedPlaces: [] });

    const result = await getNearbyCampaigns({
      startDate: '2026-01-01', endDate: '2026-01-31',
      centerLat: center.lat, centerLng: center.lng, radiusKm: 100,
    });

    expect(result.markers.map((m) => m.place)).toEqual(['CBD', 'Geelong']);
    expect(result.markers[0].distanceKm).toBe(0);
    expect(Number.isInteger(result.markers[1].distanceKm * 10)).toBe(true);
  });

  it('passes unresolvedPlaces through unchanged', async () => {
    const unresolvedPlaces = [{ state: 'VIC', place: 'Unknownville', site: '' }];
    mockGetMapData.mockResolvedValue({ markers: [], unresolvedPlaces });
    const result = await getNearbyCampaigns({
      startDate: '2026-01-01', endDate: '2026-01-31', centerLat: 0, centerLng: 0, radiusKm: 10,
    });
    expect(result.unresolvedPlaces).toBe(unresolvedPlaces);
  });
});
