import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
}));
vi.mock('@/lib/services/campaignService', () => ({
  getCampaignsByDateRange: vi.fn(),
}));
vi.mock('@/lib/services/statePlacesService', () => ({
  getStatePlaces: vi.fn(),
}));

import { supabase } from '@/lib/supabaseClient';
import { getCampaignsByDateRange } from '@/lib/services/campaignService';
import { getStatePlaces } from '@/lib/services/statePlacesService';
import { getMapData, getStatePlacesMapData, fetchPlaceCoordinates } from '../campaignMapService';
import type { Campaign } from '@/lib/types';
import type { StatePlace } from '../statePlacesService';

const mockGetCampaigns = vi.mocked(getCampaignsByDateRange);
const mockGetStatePlaces = vi.mocked(getStatePlaces);
const mockGetSession = vi.mocked(supabase.auth.getSession);

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c1', date: '2026-01-05', state: 'VIC', place: 'Melbourne', site: '', time: '10:00',
    leader: 'Alice', mobile: null, category: 'TWOL', tl_ok: false, sr_ok: false,
    created_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

function makeStatePlace(overrides: Partial<StatePlace> = {}): StatePlace {
  return { id: 'p1', state: 'VIC', place: 'Melbourne', created_at: '', ...overrides };
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
  // Fixed "now" well before the fixture campaigns' default date (2026-01-05) so the
  // past-campaign filter in getMapData doesn't strip them out of unrelated tests.
  // Tests that specifically exercise the filter override this with their own time.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-12-01T00:00:00'));
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
});

describe('getMapData', () => {
  it('groups campaigns at the same normalized place into one marker', async () => {
    mockGetCampaigns.mockResolvedValue([
      makeCampaign({ id: 'c1', place: 'Melbourne' }),
      makeCampaign({ id: 'c2', place: ' melbourne ' }),
    ]);
    mockGetStatePlaces.mockResolvedValue([
      makeStatePlace({ latitude: -37.8, longitude: 144.9 }),
    ]);

    const result = await getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]?.campaigns?.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('keeps distinct numbered sub-locations as separate markers', async () => {
    mockGetCampaigns.mockResolvedValue([
      makeCampaign({ id: 'c1', place: 'Orange 1' }),
      makeCampaign({ id: 'c2', place: 'Orange 2' }),
    ]);
    mockGetStatePlaces.mockResolvedValue([
      makeStatePlace({ place: 'Orange 1', latitude: -33.28, longitude: 149.1 }),
      makeStatePlace({ place: 'Orange 2', latitude: -33.29, longitude: 149.11 }),
    ]);

    const result = await getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(result.markers).toHaveLength(2);
    expect(result.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ place: 'Orange 1', latitude: -33.28, longitude: 149.1 }),
        expect.objectContaining({ place: 'Orange 2', latitude: -33.29, longitude: 149.11 }),
      ]),
    );
  });

  it('resolves coordinates from the cached state_places list without calling fetch', async () => {
    mockGetCampaigns.mockResolvedValue([makeCampaign()]);
    mockGetStatePlaces.mockResolvedValue([makeStatePlace({ latitude: -37.8, longitude: 144.9 })]);

    const result = await getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(result.markers).toEqual([
      expect.objectContaining({ state: 'VIC', place: 'Melbourne', latitude: -37.8, longitude: 144.9 }),
    ]);
    expect(result.unresolvedPlaces).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('marks a place unresolved when there is no session (never attempts to geocode)', async () => {
    mockGetCampaigns.mockResolvedValue([makeCampaign()]);
    mockGetStatePlaces.mockResolvedValue([]);
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);

    const result = await getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(result.markers).toEqual([]);
    expect(result.unresolvedPlaces).toEqual([{ state: 'VIC', place: 'Melbourne' }]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('geocodes an uncached place via the admin API when a session exists', async () => {
    mockGetCampaigns.mockResolvedValue([makeCampaign()]);
    mockGetStatePlaces.mockResolvedValue([]);
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ latitude: -37.8, longitude: 144.9 }),
    } as Response);

    const result = await getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/geocode-place',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      }),
    );
    expect(result.markers).toEqual([
      expect.objectContaining({ state: 'VIC', place: 'Melbourne', latitude: -37.8, longitude: 144.9 }),
    ]);
  });

  it('treats a failed geocode response as unresolved rather than throwing', async () => {
    mockGetCampaigns.mockResolvedValue([makeCampaign()]);
    mockGetStatePlaces.mockResolvedValue([]);
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({ ok: false } as Response);

    const result = await getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(result.markers).toEqual([]);
    expect(result.unresolvedPlaces).toEqual([{ state: 'VIC', place: 'Melbourne' }]);
  });

  it('excludes campaigns whose date+time have already passed', async () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00'));
    mockGetCampaigns.mockResolvedValue([
      makeCampaign({ id: 'past', date: '2026-01-05', time: '09:00' }),
      makeCampaign({ id: 'future', date: '2026-01-05', time: '15:00' }),
    ]);
    mockGetStatePlaces.mockResolvedValue([
      makeStatePlace({ latitude: -37.8, longitude: 144.9 }),
    ]);

    const result = await getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]?.campaigns?.map((c) => c.id)).toEqual(['future']);
  });

  it('drops a place entirely when every campaign there is already past', async () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00'));
    mockGetCampaigns.mockResolvedValue([
      makeCampaign({ id: 'past', date: '2026-01-05', time: '09:00' }),
    ]);
    mockGetStatePlaces.mockResolvedValue([
      makeStatePlace({ latitude: -37.8, longitude: 144.9 }),
    ]);

    const result = await getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(result.markers).toEqual([]);
    expect(result.unresolvedPlaces).toEqual([]);
  });

  it('spaces out multiple uncached geocode lookups by ~1.1s to respect Nominatim rate limits', async () => {
    vi.useFakeTimers();
    mockGetCampaigns.mockResolvedValue([
      makeCampaign({ id: 'c1', place: 'Melbourne' }),
      makeCampaign({ id: 'c2', place: 'Geelong' }),
    ]);
    mockGetStatePlaces.mockResolvedValue([]);
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ latitude: -37.8, longitude: 144.9 }),
    } as Response);

    const resultPromise = getMapData({ startDate: '2026-01-01', endDate: '2026-01-31' });
    await vi.advanceTimersByTimeAsync(1100);
    const result = await resultPromise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.markers).toHaveLength(2);
  });
});

describe('getStatePlacesMapData', () => {
  it('builds one marker per place using cached coordinates, without campaigns', async () => {
    mockGetStatePlaces.mockResolvedValue([
      makeStatePlace({ id: 'p1', place: 'Melbourne', latitude: -37.8, longitude: 144.9 }),
      makeStatePlace({ id: 'p2', place: 'Geelong', latitude: -38.15, longitude: 144.36 }),
    ]);

    const result = await getStatePlacesMapData();

    expect(result.markers).toHaveLength(2);
    expect(result.markers.every((m) => m.campaigns === undefined)).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('collapses two places that resolve to the same coordinates into a single pin', async () => {
    mockGetStatePlaces.mockResolvedValue([
      makeStatePlace({ id: 'p1', place: 'Chadstone', latitude: -37.888, longitude: 145.085 }),
      makeStatePlace({ id: 'p2', place: 'Chadstone Shopping Centre', latitude: -37.888, longitude: 145.085 }),
    ]);

    const result = await getStatePlacesMapData();

    expect(result.markers).toHaveLength(1);
  });

  it('keeps distinct places with different coordinates as separate pins', async () => {
    mockGetStatePlaces.mockResolvedValue([
      makeStatePlace({ id: 'p1', place: 'Orange 1', latitude: -33.28, longitude: 149.1 }),
      makeStatePlace({ id: 'p2', place: 'Orange 2', latitude: -33.29, longitude: 149.11 }),
    ]);

    const result = await getStatePlacesMapData();

    expect(result.markers).toHaveLength(2);
  });

  it('geocodes a place with no cached coordinates via the admin API', async () => {
    mockGetStatePlaces.mockResolvedValue([makeStatePlace({ latitude: null, longitude: null })]);
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ latitude: -37.8, longitude: 144.9 }),
    } as Response);

    const result = await getStatePlacesMapData();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/geocode-place',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.markers).toEqual([
      expect.objectContaining({ state: 'VIC', place: 'Melbourne', latitude: -37.8, longitude: 144.9 }),
    ]);
  });

  it('marks a place unresolved when coordinates cannot be found', async () => {
    mockGetStatePlaces.mockResolvedValue([makeStatePlace({ latitude: null, longitude: null })]);
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);

    const result = await getStatePlacesMapData();

    expect(result.markers).toEqual([]);
    expect(result.unresolvedPlaces).toEqual([{ state: 'VIC', place: 'Melbourne' }]);
  });

  it('passes the state filter through to getStatePlaces', async () => {
    mockGetStatePlaces.mockResolvedValue([]);

    await getStatePlacesMapData({ state: 'NSW' });

    expect(mockGetStatePlaces).toHaveBeenCalledWith('NSW');
  });
});

describe('fetchPlaceCoordinates', () => {
  it('returns null without calling the API when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);

    const result = await fetchPlaceCoordinates('VIC', 'Melbourne');

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts state and place to the geocode-place API and returns the coordinates', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ latitude: -37.8, longitude: 144.9 }),
    } as Response);

    const result = await fetchPlaceCoordinates('VIC', 'Melbourne');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/geocode-place',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
        body: JSON.stringify({ state: 'VIC', place: 'Melbourne' }),
      }),
    );
    expect(result).toEqual({ latitude: -37.8, longitude: 144.9 });
  });

  it('returns null when the API responds with an error status', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({ ok: false } as Response);

    const result = await fetchPlaceCoordinates('VIC', 'Melbourne');

    expect(result).toBeNull();
  });

  it('includes force in the request body when passed, to bypass the API cache', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ latitude: -37.8, longitude: 144.9 }),
    } as Response);

    await fetchPlaceCoordinates('VIC', 'Melbourne', true);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/geocode-place',
      expect.objectContaining({
        body: JSON.stringify({ state: 'VIC', place: 'Melbourne', force: true }),
      }),
    );
  });
});
