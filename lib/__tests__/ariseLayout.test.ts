import { describe, it, expect } from 'vitest';
import { computeTimeLeaderGap, getAriseDateRange, MIN_COMFORTABLE_SCALE } from '../ariseLayout';

describe('getAriseDateRange', () => {
  it('returns 8 consecutive days starting at startDate', () => {
    const start = new Date(2026, 7, 10); // Mon 10 Aug 2026
    const dates = getAriseDateRange(start);
    expect(dates).toHaveLength(8);
    expect(dates.map((d) => d.getDate())).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('day 7 (index 7) is the Monday that starts week 2', () => {
    const start = new Date(2026, 7, 10); // Mon 10 Aug 2026
    const dates = getAriseDateRange(start);
    expect(dates[7].getDate()).toBe(17);
    expect(dates[7].getDay()).toBe(1); // Monday
  });

  it('rolls over a month boundary correctly', () => {
    const start = new Date(2026, 7, 27); // Thu 27 Aug 2026
    const dates = getAriseDateRange(start);
    // 27, 28, 29, 30, 31 Aug then 1, 2, 3 Sep
    expect(dates.map((d) => `${d.getMonth()}-${d.getDate()}`)).toEqual([
      '7-27', '7-28', '7-29', '7-30', '7-31', '8-1', '8-2', '8-3',
    ]);
  });

  it('does not mutate the startDate argument', () => {
    const start = new Date(2026, 7, 10);
    const startCopy = new Date(start);
    getAriseDateRange(start);
    expect(start.getTime()).toBe(startCopy.getTime());
  });
});

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
