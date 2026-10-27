/**
 * Pure search / filter / sort for the Campaign Reports management screen
 * (app/admin/campaign-reports/page.tsx). The whole list (~6.5k rows) is
 * fetched once and narrowed in the browser, like /registry/manage.
 */
import type { ManageReport } from '@/lib/campaignReportManageTypes';

export interface ReportFilters {
  search: string;
  /** 'all', 'none' (no state yet) or a state code. */
  state: string;
  placeStatus: 'all' | 'missing' | 'set';
  needsReviewOnly: boolean;
  /** 'all' or a submission year, e.g. '2026'. */
  year: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  search: '', state: 'all', placeStatus: 'all', needsReviewOnly: false, year: 'all',
};

export type ReportSortColumn = 'submittedAt' | 'campaignDate' | 'location' | 'leader' | 'state' | 'place';
export type SortDirection = 'asc' | 'desc';

export function filterReports(reports: ManageReport[], f: ReportFilters): ManageReport[] {
  const needle = f.search.trim().toLowerCase();
  return reports.filter((r) => {
    if (f.state === 'none' && r.state) return false;
    if (f.state !== 'none' && f.state !== 'all' && r.state !== f.state) return false;
    if (f.placeStatus === 'missing' && r.place) return false;
    if (f.placeStatus === 'set' && !r.place) return false;
    if (f.needsReviewOnly && !r.needsReview) return false;
    if (f.year !== 'all' && !r.submittedAt.startsWith(f.year)) return false;
    if (needle) {
      const haystack = [r.location, r.leader, r.place, r.matchedLeader, r.state].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

function sortValue(r: ManageReport, column: ReportSortColumn): string {
  switch (column) {
    case 'submittedAt': return r.submittedAt;
    case 'campaignDate': return r.campaignDate ?? '';
    case 'location': return (r.location ?? '').toLowerCase();
    case 'leader': return (r.leader ?? '').toLowerCase();
    case 'state': return r.state ?? '';
    case 'place': return (r.place ?? '').toLowerCase();
  }
}

/** Sorted copy; blank values always sort last whichever way you sort. */
export function sortReports(reports: ManageReport[], column: ReportSortColumn, direction: SortDirection): ManageReport[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...reports].sort((a, b) => {
    const av = sortValue(a, column);
    const bv = sortValue(b, column);
    if (av === bv) return 0;
    if (av === '') return 1;
    if (bv === '') return -1;
    return av < bv ? -sign : sign;
  });
}

/** Distinct submission years, newest first, for the year filter. */
export function reportYears(reports: ManageReport[]): string[] {
  return [...new Set(reports.map((r) => r.submittedAt.slice(0, 4)))].sort().reverse();
}

export interface ReportSummary {
  total: number;
  noState: number;
  noPlace: number;
  needsReview: number;
}

export function summarizeReports(reports: ManageReport[]): ReportSummary {
  return {
    total: reports.length,
    noState: reports.filter((r) => !r.state).length,
    noPlace: reports.filter((r) => !r.place).length,
    needsReview: reports.filter((r) => r.needsReview).length,
  };
}
