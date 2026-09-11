// Faceted "find a record by a specific value" lookups for the record pane
// under /registry/manage's grid (app/registry/manage/page.tsx). Distinct
// from registrantCounts.ts's grid tallying: this is a plain post-hoc filter
// over whichever records a grid cell already matched, not a second axis of
// the grid itself. Kept pure/framework-free, same precedent as the rest of
// lib/registryPipeline/.
//
// Deliberately covers every pane column except State and Date registered —
// State already has its own axis (the grid's columns, plus a constrained
// edit dropdown) and Date registered is continuous/high-cardinality in a
// way a value picker doesn't suit; both were explicitly excluded by
// request. Mobile is included (maps to the `phone` field/column).

/** The subset of a registrant record these lookups actually read — anything with these five fields (ManageRegistrant included) works, nothing more is required. */
export interface LookupableRegistrant {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
}

export const LOOKUP_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'postcode'] as const;
export type LookupField = (typeof LOOKUP_FIELDS)[number];

/** Display label per field — 'phone' reads as 'Mobile' here, matching the pane's own column header. */
export const LOOKUP_FIELD_LABELS: Record<LookupField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Mobile',
  postcode: 'Postcode',
};

/** Sentinel select value representing "this field is null or blank" — never a value a real record could hold, so it can't collide with an actual stored value. */
export const BLANK_VALUE_OPTION = '__blank__';

/** { field: selected value | BLANK_VALUE_OPTION }. A field absent (or '') means "no filter on this field". */
export type LookupFilters = Partial<Record<LookupField, string>>;

export interface LookupOption {
  value: string;
  label: string;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/**
 * The dropdown's own option list for one field: every distinct non-blank
 * value actually present in `records`, sorted, plus a leading "(blank)"
 * option only if at least one record actually has a blank value for this
 * field — "the set of values already stored", not a fixed list.
 */
export function getLookupOptions<T extends LookupableRegistrant>(records: T[], field: LookupField): LookupOption[] {
  const distinct = new Set<string>();
  let hasBlank = false;
  for (const record of records) {
    const value = record[field];
    if (isBlank(value)) {
      hasBlank = true;
    } else {
      distinct.add(value as string);
    }
  }
  const options: LookupOption[] = Array.from(distinct)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
  return hasBlank ? [{ value: BLANK_VALUE_OPTION, label: '(blank)' }, ...options] : options;
}

/** True if `record` satisfies every active filter (fields with no filter set are ignored) — an empty `filters` always matches. */
export function matchesLookupFilters<T extends LookupableRegistrant>(record: T, filters: LookupFilters): boolean {
  for (const field of LOOKUP_FIELDS) {
    const selected = filters[field];
    if (!selected) continue;
    const actual = record[field];
    if (selected === BLANK_VALUE_OPTION) {
      if (!isBlank(actual)) return false;
    } else if (actual !== selected) {
      return false;
    }
  }
  return true;
}

export function filterByLookups<T extends LookupableRegistrant>(records: T[], filters: LookupFilters): T[] {
  return records.filter((record) => matchesLookupFilters(record, filters));
}
