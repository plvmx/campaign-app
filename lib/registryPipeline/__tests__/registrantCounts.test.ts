import { describe, it, expect } from 'vitest';
import {
  resolvePeriodRange,
  countAllRegistrants,
  countRegistrantsForPeriod,
  MANAGE_CONSOLE_STATES,
  type RegistrantForCount,
} from '../registrantCounts';

const NOW = new Date('2026-09-10T12:00:00Z');

function row(state: string | null, registeredAt: string | null): RegistrantForCount {
  return { state, registeredAt };
}

describe('resolvePeriodRange', () => {
  it('anchors a rolling period to now', () => {
    expect(resolvePeriodRange('last_24_hours', NOW)).toEqual({
      start: NOW.getTime() - 24 * 60 * 60 * 1000,
      end: NOW.getTime(),
    });
  });

  it('resolves year_to_date from Jan 1st of the current year to now', () => {
    expect(resolvePeriodRange('year_to_date', NOW)).toEqual({
      start: Date.UTC(2026, 0, 1),
      end: NOW.getTime(),
    });
  });

  it('resolves a fixed calendar year regardless of now, not clamped to it', () => {
    expect(resolvePeriodRange('2024', NOW)).toEqual({
      start: Date.UTC(2024, 0, 1),
      end: Date.UTC(2025, 0, 1),
    });
  });
});

describe('countAllRegistrants', () => {
  it('counts every row regardless of registeredAt, bucketing by state', () => {
    const rows = [
      row('VIC', null),
      row('vic', '2020-01-01T00:00:00Z'), // lowercase — must normalize
      row('NSW', '2026-09-01T00:00:00Z'),
      row(null, '2026-09-01T00:00:00Z'),
      row('OS', '2026-09-01T00:00:00Z'), // not a recognized code
    ];
    const result = countAllRegistrants(rows);
    expect(result.total).toBe(5);
    expect(result.byState.VIC).toBe(2);
    expect(result.byState.NSW).toBe(1);
    expect(result.unknown).toBe(2);
  });

  it('initializes every known state to zero even when absent from the data', () => {
    const result = countAllRegistrants([]);
    for (const s of MANAGE_CONSOLE_STATES) {
      expect(result.byState[s]).toBe(0);
    }
    expect(result.total).toBe(0);
    expect(result.unknown).toBe(0);
  });
});

describe('countRegistrantsForPeriod', () => {
  const rows = [
    row('VIC', '2026-09-10T06:00:00Z'), // within last 24h of NOW
    row('VIC', '2026-08-01T00:00:00Z'), // outside last 24h, within last month
    row('NSW', '2025-01-01T00:00:00Z'), // old
    row('QLD', null), // never matches a period
  ];

  it('only counts rows whose registeredAt falls within the resolved window', () => {
    const result = countRegistrantsForPeriod(rows, 'last_24_hours', NOW);
    expect(result.total).toBe(1);
    expect(result.byState.VIC).toBe(1);
  });

  it('excludes a row with no registeredAt from every period', () => {
    const result = countRegistrantsForPeriod(rows, 'last_12_months', NOW);
    expect(result.total).toBe(2); // the two VIC rows, not the null-date QLD row
    expect(result.byState.QLD).toBe(0);
  });

  it('is exclusive of the window end (a fixed calendar year does not leak into the next)', () => {
    const boundary = [row('VIC', '2025-01-01T00:00:00Z')]; // exactly midnight Jan 1 2025 = start of 2025, not part of 2024
    expect(countRegistrantsForPeriod(boundary, '2024', NOW).total).toBe(0);
    expect(countRegistrantsForPeriod(boundary, '2025', NOW).total).toBe(1);
  });

  it('ignores an unparseable registeredAt rather than throwing', () => {
    const bad = [row('VIC', 'not-a-date')];
    expect(countRegistrantsForPeriod(bad, 'last_12_months', NOW).total).toBe(0);
  });
});
