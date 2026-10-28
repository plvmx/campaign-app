import { describe, it, expect } from 'vitest';
import { isWithinState } from '../stateBounds';

describe('isWithinState', () => {
  it('accepts a point inside the state', () => {
    expect(isWithinState(-37.81, 144.96, 'VIC')).toBe(true); // Melbourne
    expect(isWithinState(-12.46, 130.84, 'NT')).toBe(true); // Darwin
  });
  it('rejects a point in a distant state, e.g. a Brisbane suburb for a Victorian place', () => {
    expect(isWithinState(-27.47, 153.03, 'VIC')).toBe(false);
    expect(isWithinState(-37.81, 144.96, 'QLD')).toBe(false);
    expect(isWithinState(-12.46, 130.84, 'SA')).toBe(false);
  });
  it('is case-insensitive and never rejects a state it has no box for', () => {
    expect(isWithinState(-37.81, 144.96, 'vic')).toBe(true);
    expect(isWithinState(51.5, -0.12, 'OS')).toBe(true);
  });
});
