import { describe, expect, it } from 'vitest';
import { isActiveListStatus, isExcludedList } from '../listFilter';

describe('isExcludedList', () => {
  it('excludes List 3 (Business Life)', () => {
    expect(isExcludedList('3')).toBe(true);
  });

  it('excludes List 5 (Tony Mclennan)', () => {
    expect(isExcludedList('5')).toBe(true);
  });

  it('does not exclude List 1', () => {
    expect(isExcludedList('1')).toBe(false);
  });

  it('does not exclude List 2', () => {
    expect(isExcludedList('2')).toBe(false);
  });
});

describe('isActiveListStatus', () => {
  it('treats status 1 as active', () => {
    expect(isActiveListStatus('1')).toBe(true);
  });

  it('treats a bounced status (e.g. 3) as not active', () => {
    expect(isActiveListStatus('3')).toBe(false);
  });

  it('treats null/undefined status as not active', () => {
    expect(isActiveListStatus(null)).toBe(false);
    expect(isActiveListStatus(undefined)).toBe(false);
  });
});
