import { describe, it, expect, vi } from 'vitest';

// buildNearbyMarkers pulls in campaignMapService.ts for placeKey() — that
// module also imports the browser supabase client at its top level (unused
// by placeKey itself), which throws outside a real env context. Same
// precedent as campaignMapService.test.ts.
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
}));

import { buildNearbyMarkers, type PublicNearbyCampaignRow, type PublicPlaceCoords } from '../publicCampaignsNearMeService';

const MELBOURNE = { latitude: -37.8136, longitude: 144.9631 };
const GEELONG_COORDS = { latitude: -38.1499, longitude: 144.3617 }; // ~63km from Melbourne
const SYDNEY_COORDS = { latitude: -33.8688, longitude: 151.2093 }; // ~700km from Melbourne

function campaign(overrides: Partial<PublicNearbyCampaignRow> = {}): PublicNearbyCampaignRow {
  return { id: 'c1', date: '2026-09-20', state: 'VIC', place: 'Melbourne', time: '10:00', leader: 'Jane Leader', category: null, ...overrides };
}

describe('buildNearbyMarkers', () => {
  it('includes a place within the radius and excludes one outside it', () => {
    const campaigns = [
      campaign({ id: 'c1', place: 'Melbourne', state: 'VIC' }),
      campaign({ id: 'c2', place: 'Sydney', state: 'NSW' }),
    ];
    const coords: PublicPlaceCoords[] = [
      { state: 'VIC', place: 'Melbourne', ...MELBOURNE },
      { state: 'NSW', place: 'Sydney', ...SYDNEY_COORDS },
    ];

    const { markers, unresolvedCount } = buildNearbyMarkers(campaigns, coords, MELBOURNE, 60);

    expect(markers).toHaveLength(1);
    expect(markers[0].place).toBe('Melbourne');
    expect(unresolvedCount).toBe(0);
  });

  it('groups multiple campaigns at the same place under one marker', () => {
    const campaigns = [
      campaign({ id: 'c1', place: 'Melbourne', time: '09:00' }),
      campaign({ id: 'c2', place: 'Melbourne', time: '18:00' }),
    ];
    const coords: PublicPlaceCoords[] = [{ state: 'VIC', place: 'Melbourne', ...MELBOURNE }];

    const { markers } = buildNearbyMarkers(campaigns, coords, MELBOURNE, 60);

    expect(markers).toHaveLength(1);
    expect(markers[0].campaigns.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('matches place/state case- and whitespace-insensitively against the coords list', () => {
    const campaigns = [campaign({ place: '  Melbourne ', state: 'vic' })];
    const coords: PublicPlaceCoords[] = [{ state: 'VIC', place: 'Melbourne', ...MELBOURNE }];

    const { markers } = buildNearbyMarkers(campaigns, coords, MELBOURNE, 60);

    expect(markers).toHaveLength(1);
  });

  it('counts a place with campaigns but no cached coordinates as unresolved, not as a marker', () => {
    const campaigns = [campaign({ place: 'Nowhereville', state: 'VIC' })];

    const { markers, unresolvedCount } = buildNearbyMarkers(campaigns, [], MELBOURNE, 60);

    expect(markers).toEqual([]);
    expect(unresolvedCount).toBe(1);
  });

  it('sorts markers nearest-first and rounds distance to one decimal', () => {
    const campaigns = [
      campaign({ id: 'c-geelong', place: 'Geelong', state: 'VIC' }),
      campaign({ id: 'c-melbourne', place: 'Melbourne', state: 'VIC' }),
    ];
    const coords: PublicPlaceCoords[] = [
      { state: 'VIC', place: 'Geelong', ...GEELONG_COORDS },
      { state: 'VIC', place: 'Melbourne', ...MELBOURNE },
    ];

    const { markers } = buildNearbyMarkers(campaigns, coords, MELBOURNE, 100);

    expect(markers.map((m) => m.place)).toEqual(['Melbourne', 'Geelong']);
    expect(markers[0].distanceKm).toBe(0);
    expect(Number.isInteger(markers[1].distanceKm * 10)).toBe(true); // one decimal place
  });

  it('returns no markers and no unresolved count for an empty campaign list', () => {
    expect(buildNearbyMarkers([], [], MELBOURNE, 60)).toEqual({ markers: [], unresolvedCount: 0 });
  });
});
