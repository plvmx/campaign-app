import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';

vi.mock('@/lib/geocoding', () => ({
  geocodePlace: vi.fn().mockResolvedValue({ latitude: -17.39, longitude: 145.39 }),
}));

import { suggestLocations, getUnresolvedLocations, saveLocationAlias } from '../campaignReportLocationsService';

const PLACES = [
  { state: 'VIC', place: 'Narre Warren', location: 'Narre Warren' },
  { state: 'SA', place: 'Adelaide CBD', location: 'Adelaide CBD' },
  { state: 'NSW', place: 'Pt Macquarie', location: 'Port Macquarie' },
  { state: 'WA', place: 'Perth CBD 1', location: 'Perth CBD' },
  { state: 'WA', place: 'Perth CBD 2', location: 'Perth CBD' },
];

describe('suggestLocations', () => {
  it('suggests a location whose name appears in the typed text', () => {
    expect(suggestLocations('fountain gate shopping centre narre warren', PLACES, null)).toEqual([{ state: 'VIC', location: 'Narre Warren' }]);
  });
  it('matches through a place label, suggesting its physical location once', () => {
    expect(suggestLocations('pt macquarie', PLACES, null)).toEqual([{ state: 'NSW', location: 'Port Macquarie' }]);
    expect(suggestLocations('perth cbd', PLACES, null)).toEqual([{ state: 'WA', location: 'Perth CBD' }]);
  });
  it('stays within a known state and suggests nothing for unrelated text', () => {
    expect(suggestLocations('narre warren', PLACES, 'SA')).toEqual([]);
    expect(suggestLocations('herberton', PLACES, null)).toEqual([]);
  });
});

function clientFor(tables: Record<string, ReturnType<typeof makeQueryBuilder>>) {
  return { from: vi.fn((t: string) => tables[t]) } as unknown as SupabaseClient;
}

describe('getUnresolvedLocations', () => {
  it('groups unmapped rows by normalized typed text, most common first, and lists the distinct locations to map to', async () => {
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
    expect(reports.is).toHaveBeenCalledWith('derived_location', null);
    expect(result.spellings.map((l) => [l.key, l.rows, l.knownState])).toEqual([['herberton', 3, 'QLD'], ['sale', 1, null]]);
    expect(result.spellings[0].example).toBe('Herberton');
    // Perth CBD 1 and 2 are one physical location.
    expect(result.locations.filter((l) => l.state === 'WA')).toEqual([{ state: 'WA', location: 'Perth CBD' }]);
  });
});

describe('saveLocationAlias', () => {
  function setup(existing: unknown[] = []) {
    const statePlaces = makeQueryBuilder({ data: existing, error: null });
    const aliases = makeQueryBuilder({ data: null, error: null });
    const reports = makeQueryBuilder({
      data: [{ id: 'r1', location_raw: 'Herberton' }, { id: 'r2', location_raw: 'Sale' }, { id: 'r3', location_raw: 'herberton QLD' }],
      error: null,
    });
    return { client: clientFor({ state_places: statePlaces, campaign_report_location_aliases: aliases, campaign_reports: reports }), statePlaces, aliases, reports };
  }

  it('adds a new location (place and location both the new name, geocoded), records the alias and updates every report with that spelling', async () => {
    const { client, statePlaces, aliases, reports } = setup();
    const r = await saveLocationAlias(client, { locationKey: 'herberton', state: 'QLD', location: null, newLocation: 'Herberton' });
    expect(r).toEqual({ ok: true, rowsUpdated: 2 });
    expect(statePlaces.insert).toHaveBeenCalledWith([
      { state: 'QLD', place: 'Herberton', location: 'Herberton', latitude: -17.39, longitude: 145.39 },
    ]);
    expect(aliases.upsert).toHaveBeenCalledWith({ location_key: 'herberton', state: 'QLD', location: 'Herberton' }, { onConflict: 'location_key' });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'QLD', derived_location: 'Herberton' });
    expect(reports.in).toHaveBeenCalledWith('id', ['r1', 'r3']);
  });

  it('maps to an existing location, using its stored spelling, without adding anything', async () => {
    const { client, statePlaces, aliases } = setup([{ state: 'WA', place: 'Perth CBD 1', location: 'Perth CBD' }]);
    const r = await saveLocationAlias(client, { locationKey: 'perth city', state: 'WA', location: 'perth cbd', newLocation: null });
    expect(r.ok).toBe(true);
    expect(statePlaces.insert).not.toHaveBeenCalled();
    expect(aliases.upsert).toHaveBeenCalledWith({ location_key: 'perth city', state: 'WA', location: 'Perth CBD' }, { onConflict: 'location_key' });
  });

  it('rejects a location that is not in State Places for that state', async () => {
    const { client, aliases } = setup([]);
    const r = await saveLocationAlias(client, { locationKey: 'sale', state: 'VIC', location: 'Nowhere', newLocation: null });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(aliases.upsert).not.toHaveBeenCalled();
  });

  it('records a state-only mapping when no location is given', async () => {
    const { client, aliases, reports } = setup();
    await saveLocationAlias(client, { locationKey: 'sale', state: 'VIC', location: null, newLocation: null });
    expect(aliases.upsert).toHaveBeenCalledWith({ location_key: 'sale', state: 'VIC', location: null }, { onConflict: 'location_key' });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_location: null });
  });

  it('rejects an invalid state', async () => {
    const { client } = setup();
    expect(await saveLocationAlias(client, { locationKey: 'sale', state: 'XX', location: null, newLocation: null })).toMatchObject({ ok: false, status: 400 });
  });
});
