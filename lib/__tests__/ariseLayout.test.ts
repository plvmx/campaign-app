import { describe, it, expect } from 'vitest';
import { computeTimeLeaderGap, MIN_COMFORTABLE_SCALE } from '../ariseLayout';

describe('computeTimeLeaderGap', () => {
  it('uses two space-widths when the column has room to spare', () => {
    // availableW comfortably exceeds naturalWWithoutGap + 2*spaceW, so the
    // resulting scale stays above MIN_COMFORTABLE_SCALE.
    const gap = computeTimeLeaderGap(1000, 1200, 20);
    expect(gap).toBe(40);
  });

  it('falls back to one space-width when two would compress the line too far', () => {
    const naturalWWithoutGap = 1000;
    const spaceW = 20;
    // Just under the two-space scale threshold (0.85 * 1040 = 884).
    const availableW = 883;
    const gap = computeTimeLeaderGap(naturalWWithoutGap, availableW, spaceW);
    expect(gap).toBe(spaceW);
  });

  it('picks two spaces exactly at the MIN_COMFORTABLE_SCALE boundary', () => {
    const naturalWWithoutGap = 1000;
    const spaceW = 20;
    // Choose availableW so the two-space scale lands exactly on the threshold.
    const availableW = MIN_COMFORTABLE_SCALE * (naturalWWithoutGap + 2 * spaceW);
    const gap = computeTimeLeaderGap(naturalWWithoutGap, availableW, spaceW);
    expect(gap).toBe(2 * spaceW);
  });

  it('falls back to one space-width just below the boundary', () => {
    const naturalWWithoutGap = 1000;
    const spaceW = 20;
    const availableW = MIN_COMFORTABLE_SCALE * (naturalWWithoutGap + 2 * spaceW) - 1;
    const gap = computeTimeLeaderGap(naturalWWithoutGap, availableW, spaceW);
    expect(gap).toBe(spaceW);
  });
});
