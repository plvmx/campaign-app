import { describe, it, expect } from 'vitest';
import { formatCampaignDateTimeDisplay, getEarliestCampaign } from '../campaignUtils';

describe('formatCampaignDateTimeDisplay', () => {
  it('combines the date and time into a single readable line', () => {
    // 2026-07-12 is a Sunday — kept as a plain, verifiable example date rather
    // than asserting a specific weekday name against a hand-picked one.
    expect(formatCampaignDateTimeDisplay('2026-07-12', '10:00:00')).toBe('Sunday 12th July 10:00 AM');
  });

  it('handles an HH:MM time without seconds', () => {
    expect(formatCampaignDateTimeDisplay('2026-01-01', '14:30')).toBe('Thursday 1st January 2:30 PM');
  });
});

describe('getEarliestCampaign', () => {
  it('returns undefined for an empty list', () => {
    expect(getEarliestCampaign([])).toBeUndefined();
  });

  it('returns the only campaign in a single-item list', () => {
    const c = { date: '2026-07-12', time: '10:00:00' };
    expect(getEarliestCampaign([c])).toBe(c);
  });

  it('picks the earliest date when dates differ', () => {
    const later = { date: '2026-07-20', time: '09:00:00' };
    const earlier = { date: '2026-07-12', time: '18:00:00' };
    expect(getEarliestCampaign([later, earlier])).toBe(earlier);
  });

  it('picks the earliest time when dates are the same', () => {
    const later = { date: '2026-07-12', time: '18:00:00' };
    const earlier = { date: '2026-07-12', time: '09:00:00' };
    expect(getEarliestCampaign([later, earlier])).toBe(earlier);
  });

  it('does not depend on array order — array/date/time ordering are independent axes', () => {
    const a = { date: '2026-07-15', time: '10:00:00' };
    const b = { date: '2026-07-10', time: '10:00:00' };
    const c = { date: '2026-07-10', time: '08:00:00' };
    expect(getEarliestCampaign([a, b, c])).toBe(c);
    expect(getEarliestCampaign([c, b, a])).toBe(c);
  });
});
