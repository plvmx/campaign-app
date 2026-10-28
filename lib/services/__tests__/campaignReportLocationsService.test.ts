import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';

vi.mock('@/lib/geocoding', () => ({
  geocodePlace: vi.fn().mockResolvedValue({ latitude: -17.39, longitude: 145.39 }),
}));
import { suggestPlaces, getUnresolvedLocations, saveLocationAlias } from '../campaignReportLocationsService';

const PLACES = [
  { state: 'VIC', place: 'Narre Warren' },
  { state: 'SA', place: 'Adelaide CBD' },
  { state: 'NSW', place: 'Pt Macquarie' },
  { state: 'WA', place: 'Perth CBD' },
];

describe('suggestPlaces', () => {
  it('suggests a place whose name appears in the location text', () => {
    expect(suggestPlaces('fountain gate shopping centre narre warren', PLACES, null)).toEqual([PLACES[0]]);
  });
  it('suggests a place the location text is the start of', () => {
    expect(suggestPlaces('perth', PLACES, null)).toEqual([PLACES[3]]);
  });
  it('stays within a known state and suggests nothing for unrelated text', () => {
    expect(suggestPlaces('narre warren', PLACES, 'SA')).toEqual([]);
    expect(suggestPlaces('herberton', PLACES, null)).toEqual([]);
  });
});

function clientFor(tables: Record<string, ReturnType<typeof makeQueryBuilder>>) {
  return { from: vi.fn((t: string) => tables[t]) } as unknown as SupabaseClient;
}

describe('getUnresolvedLocations', () => {
  it('groups rows by normalized location, most common first, with the shared known state', async () => {
    const reports = makeQueryBuilder({
      data: [
        { location_raw: 'Herberton', derived_state: 'QLD' },
        { location_raw: 'Herberton QLD', derived_state: 'QLD' },
        { location_raw: 'Herberton', derived_state: 'QLD' },
        { location_raw: 'Sale', derived_state: null },
      ],
      error: null,
    });
    const places = makeQueryBuilder({ data: PLACES, error: null });
    const result = await getUnresolvedLocations(clientFor({ campaign_reports: reports, state_places: places }));
    expect(result.locations.map((l) => [l.key, l.rows, l.knownState])).toEqual([['herberton', 3, 'QLD'], ['sale', 1, null]]);
    expect(result.locations[0].example).toBe('Herberton');
  });
});

describe('saveLocationAlias', () => {
  function setup(existingPlaces: unknown[] = []) {
    const statePlaces = makeQueryBuilder({ data: existingPlaces, error: null });
    const aliases = makeQueryBuilder({ data: null, error: null });
    const reports = makeQueryBuilder({
      data: [{ id: 'r1', location_raw: 'Herberton' }, { id: 'r2', location_raw: 'Sale' }, { id: 'r3', location_raw: 'herberton QLD' }],
      error: null,
    });
    return { client: clientFor({ state_places: statePlaces, campaign_report_location_aliases: aliases, campaign_reports: reports }), statePlaces, aliases, reports };
  }

  it('adds a new place, records the alias and updates every report with that spelling', async () => {
    const { client, statePlaces, aliases, reports } = setup();
    const r = await saveLocationAlias(client, { locationKey: 'herberton', state: 'QLD', place: null, newPlace: 'Herberton' });
    expect(r).toEqual({ ok: true, rowsUpdated: 2 });
    // A new place gets its location text and coordinates, so it isn't left ungeocoded and invisible on the maps.
    expect(statePlaces.insert).toHaveBeenCalledWith([
      { state: 'QLD', place: 'Herberton', location: 'Herberton', latitude: -17.39, longitude: 145.39 },
    ]);
    expect(aliases.upsert).toHaveBeenCalledWith({ location_key: 'herberton', state: 'QLD', place: 'Herberton' }, { onConflict: 'location_key' });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'QLD', derived_place: 'Herberton' });
    expect(reports.in).toHaveBeenCalledWith('id', ['r1', 'r3']);
  });

  it('rejects a place that is not in State Places for that state', async () => {
    const { client, aliases } = setup([]);
    const r = await saveLocationAlias(client, { locationKey: 'sale', state: 'VIC', place: 'Nowhere', newPlace: null });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(aliases.upsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid state', async () => {
    const { client } = setup();
    expect(await saveLocationAlias(client, { locationKey: 'sale', state: 'XX', place: null, newPlace: null })).toMatchObject({ ok: false, status: 400 });
  });
});
