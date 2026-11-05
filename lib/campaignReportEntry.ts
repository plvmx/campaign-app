/**
 * Input rules for the combined "Record Results" + campaign report entry page
 * (`/record-results/report`). Pure helpers so the rules can be unit tested.
 */

export const COUNT_MAX_DIGITS = 2;
export const NAME_MAX_LENGTH = 20;

export type ReportCountField = 'partial' | 'full' | 'sinnersPrayers';

export const REPORT_COUNT_FIELDS: ReadonlyArray<{ key: ReportCountField; label: string }> = [
  { key: 'partial', label: 'Number of Partial Presentations' },
  { key: 'full', label: 'Number of Full Presentations' },
  { key: 'sinnersPrayers', label: 'Number of Sinners Prayers' },
];

/** Keeps digits only, at most two of them. */
export function sanitizeCountInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, COUNT_MAX_DIGITS);
}

/** Keeps letters and spaces only, at most 20 characters. */
export function sanitizeNameInput(raw: string): string {
  return raw.replace(/[^A-Za-z ]/g, '').slice(0, NAME_MAX_LENGTH);
}

/** How many name boxes a (sanitized) count string calls for. */
export function nameFieldCount(count: string): number {
  const n = parseInt(count, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Grows/shrinks a names list to `size`, keeping what was already typed. */
export function resizeNames(names: string[], size: number): string[] {
  if (names.length === size) return names;
  if (names.length > size) return names.slice(0, size);
  return [...names, ...Array<string>(size - names.length).fill('')];
}

/** 'YYYY-MM-DD' -> 'dd/mm/yyyy' (the format the campaign report form uses). */
export function formatReportDate(dbDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dbDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dbDate;
}

export const COUNT_REQUIRED_MESSAGE = 'Please enter a number (enter 0 if there were none).';

/** One error per count field left blank; an empty object means the counts are valid. */
export function validateCounts(
  counts: Record<ReportCountField, string>,
): Partial<Record<ReportCountField, string>> {
  const errors: Partial<Record<ReportCountField, string>> = {};
  for (const { key } of REPORT_COUNT_FIELDS) {
    if (!/^\d{1,2}$/.test(counts[key])) errors[key] = COUNT_REQUIRED_MESSAGE;
  }
  return errors;
}

export const NAME_REQUIRED_MESSAGE = 'Please enter a name in every box.';

/**
 * For each count field, the indexes of name boxes left blank (spaces only
 * counts as blank). Fields with every box filled are omitted, so an empty
 * object means the names are valid.
 */
export function validateNames(
  names: Record<ReportCountField, string[]>,
): Partial<Record<ReportCountField, number[]>> {
  const errors: Partial<Record<ReportCountField, number[]>> = {};
  for (const { key } of REPORT_COUNT_FIELDS) {
    const blank = names[key].flatMap((n, i) => (n.trim() === '' ? [i] : []));
    if (blank.length > 0) errors[key] = blank;
  }
  return errors;
}
