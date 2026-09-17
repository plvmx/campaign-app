import { describe, it, expect } from 'vitest';
import { getStateMarkerIcon } from '../leafletMarkerIcon';

// Regression coverage for the 2026-09-17 change (Peter asked for larger,
// darker markers specifically on the Campaigns Near Me map): getStateMarkerIcon
// gained optional size/fillOpacity overrides, defaulting to the original
// 22px/0.35 so CampaignMap's own look is unchanged. The icon cache itself was
// previously keyed on state+place only — extending it to also key on
// size+fillOpacity is the fix under test here, since without it two callers
// requesting different sizes for the same state+place would silently share
// (and clobber) one cached icon.
function html(state: string, place: string, options?: Parameters<typeof getStateMarkerIcon>[2]): string {
  return getStateMarkerIcon(state, place, options).options.html as string;
}

describe('getStateMarkerIcon', () => {
  it('defaults to a 22px icon with 0.35 fill-opacity when no options are given', () => {
    const markup = html('NSW', 'Default Test Place');
    expect(markup).toContain('width:22px;height:22px');
    expect(markup).toContain('fill-opacity="0.35"');
  });

  it('honours a custom size and fillOpacity', () => {
    const markup = html('VIC', 'Near Me Test Place', { size: 30, fillOpacity: 0.5 });
    expect(markup).toContain('width:30px;height:30px');
    expect(markup).toContain('fill-opacity="0.5"');
  });

  it('scales the ring border width proportionally with size, not just the outer diameter', () => {
    const defaultMarkup = html('QLD', 'Border Scale Default');
    const largerMarkup = html('QLD', 'Border Scale Larger', { size: 44 }); // 2x the 22px default
    const defaultBorder = defaultMarkup.match(/stroke-width="([\d.]+)"/)?.[1];
    const largerBorder = largerMarkup.match(/stroke-width="([\d.]+)"/)?.[1];
    expect(Number(largerBorder)).toBeCloseTo(Number(defaultBorder) * 2, 5);
  });

  it('caches per state+place+size+fillOpacity combination, not just state+place', () => {
    // Same state+place, different options — must NOT return the same cached
    // icon (the exact bug a state+place-only cache key would produce).
    const small = getStateMarkerIcon('WA', 'Cache Key Test', { size: 22, fillOpacity: 0.35 });
    const large = getStateMarkerIcon('WA', 'Cache Key Test', { size: 30, fillOpacity: 0.5 });
    expect(small).not.toBe(large);
    expect(small.options.html).toContain('width:22px');
    expect(large.options.html).toContain('width:30px');

    // But the identical combination again does hit the cache.
    const smallAgain = getStateMarkerIcon('WA', 'Cache Key Test', { size: 22, fillOpacity: 0.35 });
    expect(smallAgain).toBe(small);
  });
});
