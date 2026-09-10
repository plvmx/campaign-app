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
});
