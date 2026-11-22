import { describe, it, expect } from 'vitest';
import { sortLocations } from '../campaignReportLocationSort';
import type { UnresolvedLocation } from '../services/campaignReportLocationsService';

const loc = (example: string, rows: number, knownState: string | null): UnresolvedLocation =>
  ({ key: example.toLowerCase(), example, rows, knownState, suggestions: [] });

const LIST = [loc('Sale', 2, 'VIC'), loc('herberton', 5, 'QLD'), loc('Albany', 1, null), loc('Ayr', 5, 'QLD'), loc('Bunbury', 1, 'WA')];
const names = (l: UnresolvedLocation[]) => l.map((x) => x.example);

describe('sortLocations', () => {
  it('sorts by number of records, ties by location', () => {
    expect(names(sortLocations(LIST, 'records', 'desc'))).toEqual(['Ayr', 'herberton', 'Sale', 'Albany', 'Bunbury']);
    expect(names(sortLocations(LIST, 'records', 'asc'))).toEqual(['Albany', 'Bunbury', 'Sale', 'Ayr', 'herberton']);
  });
  it('sorts by location ignoring case, either way', () => {
    expect(names(sortLocations(LIST, 'location', 'asc'))).toEqual(['Albany', 'Ayr', 'Bunbury', 'herberton', 'Sale']);
    expect(names(sortLocations(LIST, 'location', 'desc'))).toEqual(['Sale', 'herberton', 'Bunbury', 'Ayr', 'Albany']);
  });
  it('sorts by state with locations in order inside a state, and unknown states always last', () => {
    expect(names(sortLocations(LIST, 'state', 'asc'))).toEqual(['Ayr', 'herberton', 'Sale', 'Bunbury', 'Albany']);
    expect(names(sortLocations(LIST, 'state', 'desc'))).toEqual(['Bunbury', 'Sale', 'Ayr', 'herberton', 'Albany']);
  });
  it('does not change the input', () => {
    sortLocations(LIST, 'location', 'asc');
    expect(names(LIST)[0]).toBe('Sale');
  });
});
