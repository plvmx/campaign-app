import { describe, it, expect } from 'vitest';
import {
  normalizeLocationForMatch,
  normalizeLeaderForMatch,
  matchPlace,
  matchLeader,
  deriveCampaignReportFields,
  type PlaceRef,
  type LeaderRef,
} from '../campaignReportMatcher';

const PLACES: PlaceRef[] = [
  { state: 'NSW', place: 'Orange 1' },
  { state: 'NSW', place: 'Orange 2' },
  { state: 'NSW', place: 'Parramatta' },
  { state: 'NSW', place: 'Cronulla' },
  { state: 'VIC', place: 'Narre Warren' },
  { state: 'VIC', place: 'Dandenong' },
  { state: 'SA', place: 'Mt Gambier' },
  { state: 'QLD', place: 'Charters Twrs' },
  { state: 'WA', place: 'Perth CBD' },
  { state: 'WA', place: 'Armadale' },
  { state: 'VIC', place: 'Armadale' },
];

const LEADERS: LeaderRef[] = [
  { state: 'VIC', leader: 'Linda' },
  { state: 'NSW', leader: 'Steve G' },
  { state: 'SA', leader: 'Maria' },
  { state: 'VIC', leader: 'Michael' },
  { state: 'SA', leader: 'Michael' },
  { state: 'VIC', leader: 'Chris' },
  { state: 'NSW', leader: 'Chris' },
];

describe('normalizeLocationForMatch', () => {
  it('strips a trailing state abbreviation', () => {
    expect(normalizeLocationForMatch('Orange nsw')).toBe('Orange');
  });

  it('strips a trailing full state name', () => {
    expect(normalizeLocationForMatch('Pakenham Victoria')).toBe('Pakenham');
  });

  it('strips a parenthetical state annotation', () => {
    expect(normalizeLocationForMatch('Narre Warren (Vic)')).toBe('Narre Warren');
  });

  it('turns a stray period between letters into a space', () => {
    expect(normalizeLocationForMatch('Mt.Gambier')).toBe('Mt Gambier');
  });

  it('strips a trailing qualifier word', () => {
    expect(normalizeLocationForMatch('Werribee Station')).toBe('Werribee');
    expect(normalizeLocationForMatch('Frankston update')).toBe('Frankston');
  });

  it('strips a bracketed aside', () => {
    expect(normalizeLocationForMatch('Tewantin [main street]')).toBe('Tewantin');
  });

  it('returns an empty string for null/undefined/empty input', () => {
    expect(normalizeLocationForMatch(null)).toBe('');
    expect(normalizeLocationForMatch(undefined)).toBe('');
    expect(normalizeLocationForMatch('')).toBe('');
  });
});

describe('normalizeLeaderForMatch', () => {
  it('strips a trailing team-size annotation', () => {
    expect(normalizeLeaderForMatch('Bee Bee +2')).toBe('Bee Bee');
    expect(normalizeLeaderForMatch('Andrew C (+ 3)')).toBe('Andrew C');
    expect(normalizeLeaderForMatch('Alan , 3')).toBe('Alan');
  });

  it('strips a trailing co-leader mention', () => {
    expect(normalizeLeaderForMatch('Michael & Lanre')).toBe('Michael');
    expect(normalizeLeaderForMatch('Ron and Carolyn')).toBe('Ron');
  });

  it('returns an empty string for null/undefined/empty input', () => {
    expect(normalizeLeaderForMatch(null)).toBe('');
    expect(normalizeLeaderForMatch(undefined)).toBe('');
  });
});

describe('matchPlace', () => {
  it('matches exactly after normalization', () => {
    expect(matchPlace('Dandenong', PLACES)).toEqual([{ state: 'VIC', place: 'Dandenong' }]);
  });

  it('matches via a verified alias (typo/abbreviation correction)', () => {
    expect(matchPlace('Mount Gambier', PLACES)).toEqual([{ state: 'SA', place: 'Mt Gambier' }]);
    expect(matchPlace('Charters Towers', PLACES)).toEqual([{ state: 'QLD', place: 'Charters Twrs' }]);
  });

  it('forward-prefix matches a site-numbered place', () => {
    expect(matchPlace('Orange nsw', PLACES)).toEqual([
      { state: 'NSW', place: 'Orange 1' },
      { state: 'NSW', place: 'Orange 2' },
    ]);
  });

  it('reverse-prefix matches a place with an extra trailing descriptor', () => {
    expect(matchPlace('Perth CBD1', PLACES)).toEqual([{ state: 'WA', place: 'Perth CBD' }]);
  });

  it('returns every state a place name is ambiguous across', () => {
    const result = matchPlace('Armadale', PLACES);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.state).sort()).toEqual(['VIC', 'WA']);
  });

  it('returns an empty array when nothing matches (never guesses)', () => {
    expect(matchPlace('LifeSource Foodcare', PLACES)).toEqual([]);
  });
});

describe('matchLeader', () => {
  it('matches exactly after normalization', () => {
    expect(matchLeader('Steve G', LEADERS)).toEqual([{ state: 'NSW', leader: 'Steve G' }]);
  });

  it('falls back to a first-name-only match', () => {
    expect(matchLeader('Maria McCully', LEADERS)).toEqual([{ state: 'SA', leader: 'Maria' }]);
    expect(matchLeader('Linda H +2', LEADERS)).toEqual([{ state: 'VIC', leader: 'Linda' }]);
  });

  it('returns every state a first name is ambiguous across', () => {
    const result = matchLeader('Michael', LEADERS);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.state).sort()).toEqual(['SA', 'VIC']);
  });

  it('returns an empty array when nothing matches (never guesses)', () => {
    expect(matchLeader('Holy Spirit & David Bishop', LEADERS)).toEqual([]);
  });
});

describe('deriveCampaignReportFields', () => {
  it('resolves state, place, and leader when the place uniquely determines the state', () => {
    const result = deriveCampaignReportFields(
      { location_raw: 'Dandenong', leader_raw: 'Brent' },
      PLACES,
      LEADERS,
    );
    expect(result).toEqual({ state: 'VIC', place: 'Dandenong', leader: null }); // 'Brent' isn't in the fixture leader list
  });

  it('uses the leader to disambiguate a place name that exists in multiple states', () => {
    const result = deriveCampaignReportFields(
      { location_raw: 'Armadale', leader_raw: 'Chris' },
      PLACES,
      LEADERS,
    );
    // 'Armadale' is VIC or WA; 'Chris' is VIC or NSW — the only state in both is VIC.
    expect(result).toEqual({ state: 'VIC', place: 'Armadale', leader: 'Chris' });
  });

  it('resolves state from the leader alone when the place has no match', () => {
    const result = deriveCampaignReportFields(
      { location_raw: 'LifeSource Foodcare', leader_raw: 'Steve G' },
      PLACES,
      LEADERS,
    );
    expect(result).toEqual({ state: 'NSW', place: null, leader: 'Steve G' });
  });

  it('leaves place null when the state resolves but the site number is ambiguous', () => {
    const result = deriveCampaignReportFields(
      { location_raw: 'Orange nsw', leader_raw: 'Steve G' },
      PLACES,
      LEADERS,
    );
    expect(result).toEqual({ state: 'NSW', place: null, leader: 'Steve G' });
  });

  it('returns all-null when neither place nor leader resolves a state (never guesses)', () => {
    const result = deriveCampaignReportFields(
      { location_raw: 'Train from Sydney to Melbourne', leader_raw: 'Cancelled' },
      PLACES,
      LEADERS,
    );
    expect(result).toEqual({ state: null, place: null, leader: null });
  });

  it('trusts a unique place match over a non-corroborating leader, leaving leader unresolved', () => {
    const result = deriveCampaignReportFields(
      { location_raw: 'Cronulla', leader_raw: 'Linda' }, // Cronulla is NSW-only; Linda only matches in VIC
      PLACES,
      LEADERS,
    );
    expect(result).toEqual({ state: 'NSW', place: 'Cronulla', leader: null });
  });

  it('returns all-null when an ambiguous place and an ambiguous leader share no common state', () => {
    const result = deriveCampaignReportFields(
      { location_raw: 'Armadale', leader_raw: 'Steve G' }, // Armadale is VIC/WA; Steve G is NSW-only
      PLACES,
      LEADERS,
    );
    expect(result).toEqual({ state: null, place: null, leader: null });
  });
});
