import { describe, it, expect } from 'vitest';
import { getSlideStateShade } from '../slideLayout';

describe('getSlideStateShade', () => {
  it('lightens a known state color into a translucent background tint', () => {
    expect(getSlideStateShade('VIC')).toBe('rgba(234, 107, 20, 0.14)');
  });

  it('is case-insensitive, same as getSlideStateColor', () => {
    expect(getSlideStateShade('vic')).toBe(getSlideStateShade('VIC'));
  });

  it('returns transparent for a null state rather than a fallback color', () => {
    expect(getSlideStateShade(null)).toBe('transparent');
  });

  it('accepts a custom alpha, e.g. to highlight a selected cell more strongly', () => {
    expect(getSlideStateShade('VIC', 0.45)).toBe('rgba(234, 107, 20, 0.45)');
  });

  it('defaults alpha to 0.14 when not given', () => {
    expect(getSlideStateShade('VIC')).toBe(getSlideStateShade('VIC', 0.14));
  });
});
