import { describe, it, expect } from 'vitest';
import { toSupportNumber } from '../supportContact';

describe('toSupportNumber', () => {
  it('turns an Australian mobile into +61 form', () => {
    expect(toSupportNumber('0429 028 464')).toBe('+61429028464');
    expect(toSupportNumber('0429-028-464')).toBe('+61429028464');
  });
  it('keeps numbers already in international form', () => {
    expect(toSupportNumber('+61 429 028 464')).toBe('+61429028464');
    expect(toSupportNumber('61429028464')).toBe('+61429028464');
  });
  it('returns null for nothing usable', () => {
    expect(toSupportNumber(undefined)).toBeNull();
    expect(toSupportNumber('')).toBeNull();
    expect(toSupportNumber('abc')).toBeNull();
    expect(toSupportNumber('123')).toBeNull();
  });
});
