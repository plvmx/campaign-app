import { describe, it, expect } from 'vitest';
import { parseDeviceId, summariseVisits } from '../legacyReportVisits';

describe('parseDeviceId', () => {
  it('accepts a UUID', () => {
    expect(parseDeviceId('123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567-e89b-12d3-a456-426614174000');
  });
  it.each([undefined, null, 42, '', 'short', 'has spaces in it here', 'x'.repeat(65), "a'; drop table--"])('rejects %s', (v) => {
    expect(parseDeviceId(v)).toBeNull();
  });
});

describe('summariseVisits', () => {
  const now = new Date('2026-11-11T02:00:00Z').getTime();

  it('handles no visits', () => {
    const s = summariseVisits([], now);
    expect(s).toMatchObject({ totalVisits: 0, uniqueDevices: 0, last7Days: 0, last30Days: 0, lastVisitAt: null });
    expect(s.daily).toHaveLength(14);
  });

  it('counts windows, distinct devices and the last visit', () => {
    const s = summariseVisits([
      { visited_at: '2026-11-10T01:00:00Z', device_id: 'aaaaaaaa' },
      { visited_at: '2026-11-11T01:00:00Z', device_id: 'aaaaaaaa' },
      { visited_at: '2026-10-20T01:00:00Z', device_id: 'bbbbbbbb' },
      { visited_at: '2026-08-01T01:00:00Z', device_id: null },
      { visited_at: '2026-08-02T01:00:00Z', device_id: null },
    ], now);
    expect(s.totalVisits).toBe(5);
    expect(s.uniqueDevices).toBe(4); // two named devices + each anonymous visit once
    expect(s.last7Days).toBe(2);
    expect(s.last30Days).toBe(3);
    expect(s.lastVisitAt).toBe('2026-11-11T01:00:00.000Z');
    expect(s.daily[13]).toEqual({ date: '2026-11-11', visits: 1 });
    expect(s.daily[12]).toEqual({ date: '2026-11-10', visits: 1 });
  });
});
