import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';

vi.mock('@/lib/geocoding', () => ({ geocodePlace: vi.fn().mockResolvedValue({ latitude: -38.11, longitude: 147.07 }) }));

import { toStateLocations, ensureStateLocation } from '../stateLocations';

const ROWS = [
  { state: 'WA', place: 'Perth CBD 2', location: 'Perth CBD' },
  { state: 'WA', place: 'Perth CBD 1', location: 'Perth CBD' },
  { state: 'VIC', place: 'Frankston 1', location: 'Frankston' },
  { state: 'VIC', place: 'Frankston 2', location: 'frankston' },
  { state: 'VIC', place: 'Bare Place', location: null },
  { state: 'NSW', place: 'Campbelltown', location: 'Sydney' },
];

describe('toStateLocations', () => {
  it('is the distinct physical locations per state, sorted, falling back to the place when there is no location', () => {
    expect(toStateLocations(ROWS)).toEqual([
      { state: 'NSW', location: 'Sydney' },
      { state: 'VIC', location: 'Bare Place' },
      { state: 'VIC', location: 'Frankston' },
      { state: 'WA', location: 'Perth CBD' },
    ]);
  });
});

function clientFor(rows: unknown[]) {
  const statePlaces = makeQueryBuilder({ data: rows, error: null });
  return { client: { from: vi.fn(() => statePlaces) } as unknown as SupabaseClient, statePlaces };
}

describe('ensureStateLocation', () => {
  it('finds an existing location case-insensitively and returns its stored spelling', async () => {
    const { client, statePlaces } = clientFor(ROWS.filter((r) => r.state === 'WA'));
    expect(await ensureStateLocation(client, 'WA', 'perth cbd', false)).toEqual({ ok: true, location: 'Perth CBD' });
    expect(statePlaces.insert).not.toHaveBeenCalled();
  });

  it('reports an unknown location without adding it unless asked to', async () => {
    const { client, statePlaces } = clientFor([]);
    expect(await ensureStateLocation(client, 'VIC', 'Sale', false)).toMatchObject({ ok: false, code: 'unknown_location' });
    expect(statePlaces.insert).not.toHaveBeenCalled();
  });

  it('adds a new location as a geocoded State Places row when asked', async () => {
    const { client, statePlaces } = clientFor([]);
    expect(await ensureStateLocation(client, 'VIC', ' Sale ', true)).toEqual({ ok: true, location: 'Sale' });
    expect(statePlaces.insert).toHaveBeenCalledWith([
      { state: 'VIC', place: 'Sale', location: 'Sale', latitude: -38.11, longitude: 147.07 },
    ]);
  });

  it('refuses to add a location whose name is already a place located elsewhere (place Campbelltown, location Sydney)', async () => {
    const { client, statePlaces } = clientFor(ROWS.filter((r) => r.state === 'NSW'));
    const r = await ensureStateLocation(client, 'NSW', 'Campbelltown', true);
    expect(r).toMatchObject({ ok: false, code: 'unknown_location' });
    expect((r as { error: string }).error).toContain('Sydney');
    expect(statePlaces.insert).not.toHaveBeenCalled();
  });
});
