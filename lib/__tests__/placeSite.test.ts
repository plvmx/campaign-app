import { describe, it, expect } from 'vitest';
import { splitPlaceAndSite, combinePlaceAndSite } from '../placeSite';

describe('splitPlaceAndSite', () => {
  it('splits a trailing numeric suffix into site', () => {
    expect(splitPlaceAndSite('Orange 1')).toEqual({ place: 'Orange', site: '1' });
    expect(splitPlaceAndSite('Perth CBD 4')).toEqual({ place: 'Perth CBD', site: '4' });
  });

  it('collapses incidental double spaces before the suffix', () => {
    expect(splitPlaceAndSite('Frankston  2')).toEqual({ place: 'Frankston', site: '2' });
  });

  it('trims surrounding whitespace', () => {
    expect(splitPlaceAndSite('  Orange 1  ')).toEqual({ place: 'Orange', site: '1' });
  });

  it('returns an empty site when there is no trailing number', () => {
    expect(splitPlaceAndSite('Orange')).toEqual({ place: 'Orange', site: '' });
    expect(splitPlaceAndSite('Perth CBD')).toEqual({ place: 'Perth CBD', site: '' });
  });

  it('does not treat a place name that is only digits as place+site', () => {
    expect(splitPlaceAndSite('123')).toEqual({ place: '123', site: '' });
  });

  it('does not split a number embedded mid-string', () => {
    expect(splitPlaceAndSite('7 Eleven Corner')).toEqual({ place: '7 Eleven Corner', site: '' });
  });
});

describe('combinePlaceAndSite', () => {
  it('appends the site when present', () => {
    expect(combinePlaceAndSite('Orange', '1')).toBe('Orange 1');
  });

  it('returns the bare place when site is empty', () => {
    expect(combinePlaceAndSite('Orange', '')).toBe('Orange');
  });
});
