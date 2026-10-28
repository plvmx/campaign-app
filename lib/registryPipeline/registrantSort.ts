// Sorting for /registry/manage's record pane. Pure so it can be unit tested
// without rendering the page.
import type { ManageRegistrant } from './manageSummaryTypes';

export type RecordSortColumn =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'state'
  | 'postcode'
  | 'nfc'
  | 'registeredAt'
  | 'webinarSessionAt'
  | 'webinarAttended'
  | 'codeOfConductAgreed'
  | 'codeOfConductAgreedAt';

export type SortDirection = 'asc' | 'desc';

/** Columns holding ISO timestamps — compared as instants, not as text. */
const DATE_COLUMNS: ReadonlySet<RecordSortColumn> = new Set(['registeredAt', 'webinarSessionAt', 'codeOfConductAgreedAt']);

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function compareValues(column: RecordSortColumn, a: string, b: string): number {
  if (DATE_COLUMNS.has(column)) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  }
  return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
}

/**
 * Returns a sorted copy. A blank value (null or whitespace) always sorts
 * last, whichever the direction — otherwise an ascending sort on a
 * partly-empty column (Postcode, Webinar attended, Code agreed) would open
 * with a screenful of blanks. Ties keep their incoming order.
 */
export function sortRegistrants(
  records: readonly ManageRegistrant[],
  column: RecordSortColumn,
  direction: SortDirection,
): ManageRegistrant[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...records].sort((x, y) => {
    const a = x[column];
    const b = y[column];
    const aBlank = isBlank(a);
    const bBlank = isBlank(b);
    if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
    return sign * compareValues(column, a as string, b as string);
  });
}

export const PAGE_SIZE_OPTIONS = [50, 100, 250, 'all'] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 100;

/** How many pages `total` records make at `pageSize` (always at least 1, so "Page 1 of 1" shows for an empty list). */
export function getPageCount(total: number, pageSize: PageSize): number {
  if (pageSize === 'all') return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The slice for a 1-based page, with the page clamped into range (a list that shrinks under the admin can't strand them past the end). */
export function getPageSlice<T>(items: readonly T[], page: number, pageSize: PageSize): T[] {
  if (pageSize === 'all') return [...items];
  const clamped = Math.min(Math.max(1, page), getPageCount(items.length, pageSize));
  return items.slice((clamped - 1) * pageSize, clamped * pageSize);
}
