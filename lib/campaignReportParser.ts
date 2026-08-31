/**
 * Parsing/normalization for the "Campaign Report" project — turning a raw row
 * from Jordan's Google Sheet export (docs/campaign-report/BRIEF.md) into a
 * `campaign_reports` row. Framework-agnostic (no xlsx/Supabase imports) so it
 * can be unit tested directly and reused by both the one-off initial-load
 * script and the later incremental catch-up script.
 *
 * Two real data-quality problems drive the shape of this module (see
 * docs/campaign-report/BRIEF.md for the full investigation):
 *
 * 1. The four tally columns (Partial/Full/Sinners Prayer/Information
 *    Requests) sometimes hold a leader's free-text note instead of a number
 *    ("Nil", "10(1 with 5 persons...)", or a full narrative). `parseTallyValue`
 *    extracts a leading number where possible and always preserves the
 *    original text in a paired `*_raw` field so nothing is silently lost.
 * 2. ~25% of the "Dates" (campaign date) column isn't a native Excel date —
 *    it's a human-typed string in a wide variety of formats ("18th September
 *    2021", "6.4.24", "2024.04.06", "August 7th", "9/9/21 & 10/9/21"), or
 *    occasionally a plain digit string with no separators at all ("20240914",
 *    "50222" — Excel dropped a leading zero from "050222"). `parseCampaignDate`
 *    recovers the common patterns; anything it can't confidently parse is
 *    left null with the original text preserved and `needsReview` set, per
 *    Peter's "keep + flag" decision (2026-08-30) rather than guessing.
 */

const ZERO_TOKENS = /^(nil|none|no|n\/a|na|o)\.?$/i;
const DASH_ONLY = /^[-—–]+$/;

export interface ParsedTally {
  /** Best-effort parsed integer, or null if the cell held no recognizable number. */
  value: number | null;
  /** Original cell text, preserved whenever it wasn't already a clean number. Null otherwise. */
  raw: string | null;
}

/**
 * Parses one of the four tally cells (Partial/Full/Sinners Prayer/Information
 * Requests). A clean number passes straight through. A recognized "zero" word
 * ("Nil", "None", "—", the letter "O") becomes 0. Text starting with a number
 * ("10(1 with 5 persons...)") extracts that leading number. Anything else
 * (a narrative note with no leading digit) yields value: null — the raw text
 * is kept so a human can review it, never discarded.
 */
export function parseTallyValue(cell: unknown): ParsedTally {
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    return { value: Math.round(cell), raw: null };
  }
  if (cell === null || cell === undefined) return { value: null, raw: null };

  const text = String(cell).trim();
  if (!text) return { value: null, raw: null };

  if (ZERO_TOKENS.test(text) || DASH_ONLY.test(text)) {
    return { value: 0, raw: text };
  }

  const leadingNumber = text.match(/^-?\d+/);
  if (leadingNumber) {
    return { value: parseInt(leadingNumber[0], 10), raw: text };
  }

  return { value: null, raw: text };
}

export interface ParsedCampaignDate {
  /** YYYY-MM-DD, or null if unparseable. */
  date: string | null;
  /** Original cell text, preserved whenever the cell wasn't already a clean native date. */
  raw: string | null;
  /** True when the cell held something but it couldn't be confidently parsed into a date. */
  needsReview: boolean;
}

const MIN_YEAR = 2015;
const MAX_YEAR = 2036;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A "Campaign Report" is filed after the campaign it describes, so a future
// campaign_date is never legitimate — 45 days of slack covers any reporting
// delay. Past dates, though, genuinely run much later in this data: several
// leaders batch-submitted a full year of backlogged reports at once (real
// examples cluster at ~365-368 days late, correct date, just very late).
// Real *errors* on the past side are multiple years off (see BRIEF.md's
// 2026-09-01 investigation) — 400 days comfortably separates the two.
const MAX_FUTURE_DAYS = 45;
const MAX_PAST_DAYS = 400;

/** True if `iso` sits within a plausible reporting window of the submission timestamp. */
function isPlausibleRelativeToSubmission(iso: string, submittedAt: Date): boolean {
  const diffDays = (new Date(`${iso}T00:00:00Z`).getTime() - submittedAt.getTime()) / MS_PER_DAY;
  return diffDays <= MAX_FUTURE_DAYS && diffDays >= -MAX_PAST_DAYS;
}

/** Resolves a missing year against the submission date, correcting for a Dec-campaign/Jan-report crossing. */
function resolveYearlessDate(month: number, day: number, submittedAt: Date): string | null {
  const submittedYear = submittedAt.getFullYear();
  let iso = toIsoDate(submittedYear, month, day);
  if (iso && new Date(iso).getTime() - submittedAt.getTime() > MAX_FUTURE_DAYS * MS_PER_DAY) {
    // Resulting date is more than 45 days after the submission — almost
    // certainly a report filed after the new year for a prior-year campaign.
    iso = toIsoDate(submittedYear - 1, month, day);
  }
  return iso;
}

/** Strips leader-typed noise (day-of-week names, ordinal suffixes, "of", AM/PM) before pattern matching. */
function preprocessDateText(text: string): string {
  let s = text.trim();
  s = s.replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[.,\s]+/i, '');
  s = s.replace(/\bof\b/gi, ' ');
  s = s.replace(/\b(am|pm)\b\.?/gi, '');
  s = s.replace(/(\d+)\s*(st|nd|rd|th)\b/gi, '$1');
  // Multi-date entries ("9/9/21 & 10/9/21", "10th and 11th Dec 2021") — take the first date.
  s = s.split(/\s*(?:&|\band\b)\s*/i)[0];
  // A leading day-range ("24/25 June", "19-20 December 2022", "10-13 Nov") — drop the second day.
  s = s.replace(/^(\d{1,2})[-/]\d{1,2}(\s+\D)/, '$1$2');
  s = s.replace(/\s*([./])\s*/g, '$1');
  s = s.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  return s;
}

/**
 * Parses the "Dates" (campaign date) cell. `submittedAt` (the sheet's own
 * "Date" submission-timestamp column, always present and clean) is used
 * both to resolve dates with no year and — for every successful parse,
 * regardless of source — as a plausibility check: a Campaign Report always
 * describes a campaign that already happened, so a candidate date wildly
 * far from its own submission timestamp (in either direction) is far more
 * likely a mistyped year than a real date, and is flagged instead of
 * trusted. See the MAX_FUTURE_DAYS/MAX_PAST_DAYS comment above and
 * BRIEF.md's 2026-09-01 investigation for the real examples that drove this.
 */
export function parseCampaignDate(cell: unknown, submittedAt: Date): ParsedCampaignDate {
  const accept = (iso: string, raw: string | null): ParsedCampaignDate =>
    isPlausibleRelativeToSubmission(iso, submittedAt)
      ? { date: iso, raw, needsReview: false }
      : { date: null, raw: raw ?? iso, needsReview: true };

  if (cell instanceof Date && !isNaN(cell.getTime())) {
    const iso = toIsoDate(cell.getFullYear(), cell.getMonth() + 1, cell.getDate());
    if (iso) return accept(iso, null);
    return { date: null, raw: cell.toString(), needsReview: true };
  }

  if (cell === null || cell === undefined) return { date: null, raw: null, needsReview: false };

  if (typeof cell === 'number' && Number.isFinite(cell)) {
    // Only trust the unambiguous case: an 8-digit YYYYMMDD typed as a plain
    // number (e.g. "20240914"). Anything shorter is ambiguous (a dropped
    // leading zero could mean several things) and gets flagged instead of
    // guessed — see BRIEF.md.
    const digits = Math.trunc(cell).toString();
    if (digits.length === 8) {
      const year = parseInt(digits.slice(0, 4), 10);
      const month = parseInt(digits.slice(4, 6), 10);
      const day = parseInt(digits.slice(6, 8), 10);
      const iso = toIsoDate(year, month, day);
      if (iso) return accept(iso, digits);
    }
    return { date: null, raw: String(cell), needsReview: true };
  }

  if (typeof cell !== 'string') return { date: null, raw: String(cell), needsReview: true };

  const original = cell.trim();
  if (!original) return { date: null, raw: null, needsReview: false };

  const text = preprocessDateText(original);

  // D.M.Y or Y.M.D (dot-separated numeric)
  let m = text.match(/^(\d{1,4})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const [, a, month, c] = m;
    const iso = a.length === 4
      ? toIsoDate(parseInt(a, 10), parseInt(month, 10), parseInt(c, 10)) // Y.M.D
      : toIsoDate(expandYear(parseInt(c, 10)), parseInt(month, 10), parseInt(a, 10)); // D.M.Y
    if (iso) return accept(iso, original);
  }

  // D/M/Y or Y/M/D (slash-separated numeric)
  m = text.match(/^(\d{1,4})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, a, month, c] = m;
    const iso = a.length === 4
      ? toIsoDate(parseInt(a, 10), parseInt(month, 10), parseInt(c, 10))
      : toIsoDate(expandYear(parseInt(c, 10)), parseInt(month, 10), parseInt(a, 10));
    if (iso) return accept(iso, original);
  }

  // "D Month[, Y]"
  m = text.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s*(\d{2,4})?$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) {
      const day = parseInt(m[1], 10);
      const iso = m[3] ? toIsoDate(expandYear(parseInt(m[3], 10)), month, day) : resolveYearlessDate(month, day, submittedAt);
      if (iso) return accept(iso, original);
    }
  }

  // "Month D[, Y]"
  m = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2})\.?,?\s*(\d{2,4})?$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) {
      const day = parseInt(m[2], 10);
      const iso = m[3] ? toIsoDate(expandYear(parseInt(m[3], 10)), month, day) : resolveYearlessDate(month, day, submittedAt);
      if (iso) return accept(iso, original);
    }
  }

  return { date: null, raw: original, needsReview: true };
}

/** A raw row exactly as read from the "campaign report" sheet (see BRIEF.md for the column layout). */
export interface RawCampaignReportSheetRow {
  /** The sheet's "Date" column — Google Form submission timestamp. Always a clean datetime in every row seen so far. */
  submittedAt: unknown;
  location: unknown;
  leader: unknown;
  /** The sheet's "Dates" column — the actual campaign date. */
  campaignDate: unknown;
  partialPresentations: unknown;
  fullPresentations: unknown;
  sinnersPrayer: unknown;
  informationRequests: unknown;
}

/** Target shape for an insert into the `campaign_reports` table (scripts/create_campaign_reports_table.sql). */
export interface CampaignReportInsert {
  submitted_at: string;
  campaign_date: string | null;
  campaign_date_raw: string | null;
  location_raw: string | null;
  leader_raw: string | null;
  partial_presentations: number | null;
  partial_presentations_raw: string | null;
  full_presentations: number | null;
  full_presentations_raw: string | null;
  sinners_prayer: number | null;
  sinners_prayer_raw: string | null;
  information_requests: number | null;
  information_requests_raw: string | null;
  needs_review: boolean;
  source: string;
}

function toTrimmedTextOrNull(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  const text = String(cell).trim();
  return text || null;
}

/**
 * Normalizes one raw sheet row into a `campaign_reports` insert. Returns null
 * if `submittedAt` isn't a usable timestamp — that column is the row's unique
 * de-dup key (see BRIEF.md), so a row without one can't be loaded at all;
 * the caller is expected to log and skip it.
 */
export function normalizeCampaignReportRow(row: RawCampaignReportSheetRow): CampaignReportInsert | null {
  const submittedAt = row.submittedAt instanceof Date && !isNaN(row.submittedAt.getTime()) ? row.submittedAt : null;
  if (!submittedAt) return null;

  const date = parseCampaignDate(row.campaignDate, submittedAt);
  const partial = parseTallyValue(row.partialPresentations);
  const full = parseTallyValue(row.fullPresentations);
  const sinnersPrayer = parseTallyValue(row.sinnersPrayer);
  const informationRequests = parseTallyValue(row.informationRequests);

  const needsReview =
    date.needsReview ||
    (partial.value === null && partial.raw !== null) ||
    (full.value === null && full.raw !== null) ||
    (sinnersPrayer.value === null && sinnersPrayer.raw !== null) ||
    (informationRequests.value === null && informationRequests.raw !== null);

  return {
    submitted_at: submittedAt.toISOString(),
    campaign_date: date.date,
    campaign_date_raw: date.raw,
    location_raw: toTrimmedTextOrNull(row.location),
    leader_raw: toTrimmedTextOrNull(row.leader),
    partial_presentations: partial.value,
    partial_presentations_raw: partial.raw,
    full_presentations: full.value,
    full_presentations_raw: full.raw,
    sinners_prayer: sinnersPrayer.value,
    sinners_prayer_raw: sinnersPrayer.raw,
    information_requests: informationRequests.value,
    information_requests_raw: informationRequests.raw,
    needs_review: needsReview,
    source: 'jordan_sheet_import',
  };
}
