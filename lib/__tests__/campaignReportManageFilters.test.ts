import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REPORT_FILTERS, filterReports, sortReports, reportYears, summarizeReports,
} from '../campaignReportManageFilters';
import type { ManageReport } from '../campaignReportManageTypes';

function report(o: Partial<ManageReport>): ManageReport {
  return {
    id: 'x', submittedAt: '2026-01-01T00:00:00Z', campaignDate: '2026-01-01', campaignDateRaw: null,
    locationTyped: 'Dandenong', leader: 'Brent', state: 'VIC', location: 'Dandenong', matchedLeader: 'Brent',
    partial: 1, full: 1, sinnersPrayer: 0, infoRequests: 0, needsReview: false, ...o,
  };
}

const ROWS = [
  report({ id: 'a', locationTyped: 'Dandenong' }),
  report({ id: 'b', locationTyped: 'Herberton', state: 'QLD', location: null, matchedLeader: null, leader: 'Lorraine', submittedAt: '2025-03-01T00:00:00Z', campaignDate: '2025-03-01' }),
  report({ id: 'c', locationTyped: 'Sale', state: null, location: null, matchedLeader: null, needsReview: true, submittedAt: '2024-06-01T00:00:00Z', campaignDate: null }),
];

describe('filterReports', () => {
  const ids = (f: Partial<typeof DEFAULT_REPORT_FILTERS>) => filterReports(ROWS, { ...DEFAULT_REPORT_FILTERS, ...f }).map((r) => r.id);

  it('returns everything by default', () => expect(ids({})).toEqual(['a', 'b', 'c']));
  it('filters by state, including "no state"', () => {
    expect(ids({ state: 'QLD' })).toEqual(['b']);
    expect(ids({ state: 'none' })).toEqual(['c']);
  });
  it('filters by whether a location is mapped', () => {
    expect(ids({ locationStatus: 'missing' })).toEqual(['b', 'c']);
    expect(ids({ locationStatus: 'set' })).toEqual(['a']);
  });
  it('filters by needs-review and submission year', () => {
    expect(ids({ needsReviewOnly: true })).toEqual(['c']);
    expect(ids({ year: '2025' })).toEqual(['b']);
  });
  it('searches location, leader and place case-insensitively', () => {
    expect(ids({ search: 'herb' })).toEqual(['b']);
    expect(ids({ search: 'LORRAINE' })).toEqual(['b']);
    expect(ids({ search: 'dandenong' })).toEqual(['a']);
  });
  it('combines filters', () => expect(ids({ state: 'QLD', locationStatus: 'set' })).toEqual([]));
});

describe('sortReports', () => {
  it('sorts by a text column and flips direction, leaving the input untouched', () => {
    expect(sortReports(ROWS, 'locationTyped', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortReports(ROWS, 'locationTyped', 'desc').map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(ROWS.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('always puts blanks last', () => {
    expect(sortReports(ROWS, 'state', 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortReports(ROWS, 'state', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortReports(ROWS, 'campaignDate', 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('reportYears / summarizeReports', () => {
  it('lists years newest first', () => expect(reportYears(ROWS)).toEqual(['2026', '2025', '2024']));
  it('counts what still needs attention', () => {
    expect(summarizeReports(ROWS)).toEqual({ total: 3, noState: 1, noLocation: 2, needsReview: 1 });
  });
});
