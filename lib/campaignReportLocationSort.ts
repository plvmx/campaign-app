/** Sorting for the Campaign Report Locations (bulk) list. */
import type { UnresolvedLocation } from '@/lib/services/campaignReportLocationsService';

export type LocationSortColumn = 'records' | 'location' | 'state';
export type SortDirection = 'asc' | 'desc';

/**
 * Sorted copy. Records sort by count; location by its text; state by the
 * state already worked out for it, with ties (and unknown states, which
 * always come last) broken by location so a state's locations stay in order.
 */
export function sortLocations(
  locations: UnresolvedLocation[],
  column: LocationSortColumn,
  direction: SortDirection,
): UnresolvedLocation[] {
  const sign = direction === 'asc' ? 1 : -1;
  const byLocation = (a: UnresolvedLocation, b: UnresolvedLocation) => a.example.toLowerCase().localeCompare(b.example.toLowerCase());
  return [...locations].sort((a, b) => {
    if (column === 'records') return (a.rows - b.rows) * sign || byLocation(a, b);
    if (column === 'location') return byLocation(a, b) * sign;
    if (!a.knownState && !b.knownState) return byLocation(a, b);
    if (!a.knownState) return 1;
    if (!b.knownState) return -1;
    return a.knownState.localeCompare(b.knownState) * sign || byLocation(a, b);
  });
}
