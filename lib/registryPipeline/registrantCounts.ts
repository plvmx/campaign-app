// Pure date-window + per-state tallying logic for the /registry/manage
// console (the "Primary Filter" / "Alternative Filter" comparison grid —
// see app/registry/manage/page.tsx). Kept framework/IO-free, same
// precedent as the rest of lib/registryPipeline/, so the date-window math
// is unit testable without mocking Supabase or the real clock (every
// function here takes `now` explicitly rather than reading it).

/** One row of the data this module consumes — just enough per-registrant detail to tally by state and date, never any PII. */
export interface RegistrantForCount {
  state: string | null;
  registeredAt: string | null; // ISO
}

export type FilterPeriod =
  | 'last_24_hours'
  | 'last_7_days'
  | 'last_14_days'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'last_12_months'
  | 'year_to_date'
  | '2025'
  | '2024'
  | '2023'
  | '2022';

/** Drives both filter dropdowns on the console — order matches Peter's mockup. */
export const FILTER_PERIOD_OPTIONS: { value: FilterPeriod; label: string }[] = [
  { value: 'last_24_hours', label: 'Last 24 hours' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_14_days', label: 'Last 14 days' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'last_6_months', label: 'Last 6 months' },
  { value: 'last_12_months', label: 'Last 12 months' },
  { value: 'year_to_date', label: 'Year to date' },
  { value: '2025', label: '2025' },
  { value: '2024', label: '2024' },
  { value: '2023', label: '2023' },
  { value: '2022', label: '2022' },
];

/**
 * State column order for the console grid — this is Peter's mockup's own
 * ordering, not alphabetical (compare lib/constants.ts's AUSTRALIAN_STATES
 * or lib/slideLayout.ts's STATE_CODES, both alphabetical) — kept distinct
 * on purpose rather than reordering the mockup to match an existing
 * convention.
 */
export const MANAGE_CONSOLE_STATES = ['VIC', 'NSW', 'ACT', 'QLD', 'NT', 'WA', 'SA', 'TAS'] as const;

export interface PeriodCounts {
  total: number;
  byState: Record<(typeof MANAGE_CONSOLE_STATES)[number], number>;
  /** registrant has no state, or a state not in MANAGE_CONSOLE_STATES. */
  unknown: number;
}

/** [start, end) in epoch ms — end is exclusive. */
export interface DateWindow {
  start: number;
  end: number;
}

/**
 * Resolves a FilterPeriod to a concrete [start, end) window as of `now`.
 * The rolling periods (last_24_hours..last_12_months, year_to_date) end at
 * `now`; the fixed calendar-year periods (2022..2025) end at the following
 * January 1st regardless of `now`, so picking "2024" always reports that
 * whole year even after it's over.
 */
export function resolvePeriodRange(period: FilterPeriod, now: Date): DateWindow {
  const end = now.getTime();
  switch (period) {
    case 'last_24_hours':
      return { start: end - 24 * 60 * 60 * 1000, end };
    case 'last_7_days':
      return { start: end - 7 * 24 * 60 * 60 * 1000, end };
    case 'last_14_days':
      return { start: end - 14 * 24 * 60 * 60 * 1000, end };
    case 'last_month': {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      return { start: start.getTime(), end };
    }
    case 'last_3_months': {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      return { start: start.getTime(), end };
    }
    case 'last_6_months': {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 6);
      return { start: start.getTime(), end };
    }
    case 'last_12_months': {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 12);
      return { start: start.getTime(), end };
    }
    case 'year_to_date':
      return { start: Date.UTC(now.getUTCFullYear(), 0, 1), end };
    case '2025':
    case '2024':
    case '2023':
    case '2022': {
      const year = Number(period);
      return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
    }
  }
}

function emptyByState(): Record<(typeof MANAGE_CONSOLE_STATES)[number], number> {
  const byState = {} as Record<(typeof MANAGE_CONSOLE_STATES)[number], number>;
  for (const s of MANAGE_CONSOLE_STATES) byState[s] = 0;
  return byState;
}

function tally(rows: RegistrantForCount[], include: (row: RegistrantForCount) => boolean): PeriodCounts {
  const byState = emptyByState();
  let total = 0;
  let unknown = 0;
  for (const row of rows) {
    if (!include(row)) continue;
    total++;
    // Same normalization the CSV reload applies (csvRegistrantTransform.ts)
    // — ac-sync stores state as free text from the AC form field, so this
    // is what actually buckets a real value like " vic " into "VIC".
    const code = row.state?.trim().toUpperCase() ?? null;
    if (code && (MANAGE_CONSOLE_STATES as readonly string[]).includes(code)) {
      byState[code as (typeof MANAGE_CONSOLE_STATES)[number]]++;
    } else {
      unknown++;
    }
  }
  return { total, byState, unknown };
}

/** The unfiltered "All AFJ Registrations" row — every row counts, regardless of registeredAt. */
export function countAllRegistrants(rows: RegistrantForCount[]): PeriodCounts {
  return tally(rows, () => true);
}

/** A "Primary Filter" / "Alternative Filter" row — only rows whose registeredAt falls in the resolved period count; a row with no registeredAt never matches any period. */
export function countRegistrantsForPeriod(rows: RegistrantForCount[], period: FilterPeriod, now: Date = new Date()): PeriodCounts {
  const { start, end } = resolvePeriodRange(period, now);
  return tally(rows, (row) => {
    if (!row.registeredAt) return false;
    const t = new Date(row.registeredAt).getTime();
    if (Number.isNaN(t)) return false;
    return t >= start && t < end;
  });
}
