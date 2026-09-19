import { describe, it, expect, vi } from 'vitest';

// buildUpcomingCampaignMarkers pulls in campaignMapService.ts for placeKey() —
// that module also imports the browser supabase client at its top level
// (unused by placeKey itself), which throws outside a real env context.
// Same precedent as campaignMapService.test.ts / publicCampaignsNearMeService.test.ts.
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
}));

import { buildUpcomingCampaignMarkers, type PublicUpcomingCampaignRow, type PublicUpcomingPlaceCoords } from '../publicUpcomingCampaignsService';

const MELBOURNE = { latitude: -37.8136, longitude: 144.9631 };
const SYDNEY_COORDS = { latitude: -33.8688, longitude: 151.2093 };

function campaign(overrides: Partial<PublicUpcomingCampaignRow> = {}): PublicUpcomingCampaignRow {
  return { id: 'c1', date: '2026-09-20', state: 'VIC', place: 'Melbourne', time: '10:00', leader: 'Jane Leader', category: null, ...overrides };
}

describe('buildUpcomingCampaignMarkers', () => {
  it('builds one marker per resolvable place, regardless of distance from any point', () => {
    const campaigns = [
      campaign({ id: 'c1', place: 'Melbourne', state: 'VIC' }),
      campaign({ id: 'c2', place: 'Sydney', state: 'NSW' }),
    ];
    const coords: PublicUpcomingPlaceCoords[] = [
      { state: 'VIC', place: 'Melbourne', ...MELBOURNE },
      { state: 'NSW', place: 'Sydney', ...SYDNEY_COORDS },
    ];

    const { markers, unresolvedCount } = buildUpcomingCampaignMarkers(campaigns, coords);

    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.place).sort()).toEqual(['Melbourne', 'Sydney']);
    expect(unresolvedCount).toBe(0);
  });

  it('groups multiple campaigns at the same place under one marker', () => {
    const campaigns = [
      campaign({ id: 'c1', place: 'Melbourne', time: '09:00' }),
      campaign({ id: 'c2', place: 'Melbourne', time: '18:00' }),
    ];
    const coords: PublicUpcomingPlaceCoords[] = [{ state: 'VIC', place: 'Melbourne', ...MELBOURNE }];

    const { markers } = buildUpcomingCampaignMarkers(campaigns, coords);

    expect(markers).toHaveLength(1);
    expect(markers[0].campaigns.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('matches place/state case- and whitespace-insensitively against the coords list', () => {
    const campaigns = [campaign({ place: '  Melbourne ', state: 'vic' })];
    const coords: PublicUpcomingPlaceCoords[] = [{ state: 'VIC', place: 'Melbourne', ...MELBOURNE }];

    const { markers } = buildUpcomingCampaignMarkers(campaigns, coords);

    expect(markers).toHaveLength(1);
  });

  it('counts a place with campaigns but no cached coordinates as unresolved, not as a marker', () => {
    const campaigns = [campaign({ place: 'Nowhereville', state: 'VIC' })];

    const { markers, unresolvedCount } = buildUpcomingCampaignMarkers(campaigns, []);

    expect(markers).toEqual([]);
    expect(unresolvedCount).toBe(1);
  });

  it('returns no markers and no unresolved count for an empty campaign list', () => {
    expect(buildUpcomingCampaignMarkers([], [])).toEqual({ markers: [], unresolvedCount: 0 });
  });
});
