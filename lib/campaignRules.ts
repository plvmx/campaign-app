/**
 * Campaign Rules Engine
 *
 * Evaluates campaign rules and generates campaign records based on scheduling patterns.
 */

/** Typed shape for the JSONB rule_config column. */
export interface RuleConfig {
  reference_date?: string;
  exceptions?: string[];
  override_fields?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface CampaignRule {
  id: string;
  name: string;
  leader: string;
  state: string;
  place: string;
  time: string;
  mobile: string | null;
  /**
   * 'custom' is deprecated — existing DB rows only; no longer creatable via the UI.
   * Legacy custom rules generate no campaigns until migrated to a supported type.
   */
  frequency_type: 'weekly' | 'biweekly' | 'monthly' | 'custom';
  frequency_value: number | null;
  month_week_number: number | null; // 1–4 or –1 for last week
  month_day_of_week: number | null; // 0=Sunday … 6=Saturday
  day_of_week: number | null;       // 0=Sunday … 6=Saturday
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  priority: number;
  rule_config: RuleConfig;
  notes: string | null;
}

export interface GeneratedCampaign {
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  category: string;
  rule_id: string;
}

/**
 * Find the Nth occurrence of a given day-of-week within each month in the range,
 * or the last occurrence when weekNumber === -1.
 *
 * Fix vs. previous implementation: the old algorithm subtracted firstDayOfWeek from
 * the week offset, which could produce a date in the prior month that then failed the
 * month-boundary check — silently dropping valid first-week dates. This version uses
 * the correct "find first occurrence, add (N-1)*7" approach.
 */
function findMonthlyOccurrences(
  weekNumber: number,
  dayOfWeek: number | null,
  startDate: Date,
  endDate: Date
): Date[] {
  if (dayOfWeek === null) return []; // required field; guard defensively

  const matches: Date[] = [];
  // Start iterating from the first day of startDate's month.
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  while (cursor <= endDate) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();

    let targetDate: Date | null = null;

    if (weekNumber === -1) {
      // Last occurrence of dayOfWeek in the month.
      const lastDay = new Date(year, month + 1, 0);
      let daysBack = lastDay.getDay() - dayOfWeek;
      if (daysBack < 0) daysBack += 7;
      targetDate = new Date(year, month, lastDay.getDate() - daysBack);
    } else {
      // Nth occurrence (1–4): find first occurrence of dayOfWeek, then add (N-1) weeks.
      const firstDayOfMonth = new Date(year, month, 1).getDay();
      let daysToFirst = dayOfWeek - firstDayOfMonth;
      if (daysToFirst < 0) daysToFirst += 7;
      const nthDay = 1 + daysToFirst + (weekNumber - 1) * 7;
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      if (nthDay <= daysInMonth) {
        targetDate = new Date(year, month, nthDay);
      }
    }

    if (targetDate && targetDate >= startDate && targetDate <= endDate) {
      matches.push(targetDate);
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return matches;
}

/**
 * Find all dates matching a weekly pattern within the given range.
 */
function findWeeklyOccurrences(
  dayOfWeek: number,
  startDate: Date,
  endDate: Date
): Date[] {
  const matches: Date[] = [];
  const current = new Date(startDate);

  // Advance to the first occurrence of dayOfWeek on or after startDate.
  const diff = (dayOfWeek - current.getDay() + 7) % 7;
  current.setDate(current.getDate() + diff);

  while (current <= endDate) {
    matches.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }

  return matches;
}

/**
 * Find ALL dates matching a biweekly pattern within the given range.
 *
 * Fix vs. previous implementation: the old function always returned at most one result,
 * which worked by accident for the 14-day cron window but would silently produce
 * incomplete results for any wider evaluation window (e.g. the live "first campaign"
 * preview or any future wider-range query).
 *
 * Uses referenceDate (a known past occurrence) to anchor the repeating pattern so the
 * cycle stays consistent across cron runs. Falls back to the first matching dayOfWeek
 * on or after startDate when no reference is available.
 */
function findBiweeklyOccurrences(
  frequencyValue: number,
  dayOfWeek: number,
  startDate: Date,
  endDate: Date,
  referenceDate: string | null
): Date[] {
  const matches: Date[] = [];
  const msPerPeriod = frequencyValue * 7 * 24 * 60 * 60 * 1000;

  const normStart = new Date(startDate); normStart.setHours(0, 0, 0, 0);
  const normEnd   = new Date(endDate);   normEnd.setHours(23, 59, 59, 999);

  // Establish an anchor: any confirmed occurrence of this biweekly pattern.
  let anchor: Date;
  if (referenceDate) {
    const [y, m, d] = referenceDate.split('-').map(Number);
    anchor = new Date(y, m - 1, d);
    anchor.setHours(0, 0, 0, 0);
    // Correct day-of-week if the stored reference doesn't match (defensive).
    if (anchor.getDay() !== dayOfWeek) {
      anchor.setDate(anchor.getDate() + (dayOfWeek - anchor.getDay() + 7) % 7);
    }
  } else {
    // No reference: the first dayOfWeek on or after normStart becomes the anchor.
    anchor = new Date(normStart);
    anchor.setDate(anchor.getDate() + (dayOfWeek - anchor.getDay() + 7) % 7);
  }

  // Walk the anchor to the first occurrence at or after normStart using integer arithmetic
  // to avoid floating-point drift across many period steps.
  let firstInRange: Date;
  if (anchor <= normStart) {
    const periods = Math.ceil((normStart.getTime() - anchor.getTime()) / msPerPeriod);
    firstInRange = new Date(anchor.getTime() + periods * msPerPeriod);
  } else {
    // Anchor is after normStart: step back to the earliest occurrence still >= normStart.
    const periods = Math.floor((anchor.getTime() - normStart.getTime()) / msPerPeriod);
    const candidate = new Date(anchor.getTime() - periods * msPerPeriod);
    firstInRange = candidate >= normStart ? candidate : anchor;
  }

  // Collect every occurrence from firstInRange to normEnd.
  let current = new Date(firstInRange);
  while (current <= normEnd) {
    matches.push(new Date(current));
    current = new Date(current.getTime() + msPerPeriod);
  }

  return matches;
}

/**
 * Returns true if `date` falls within the rule's start_date / end_date window.
 *
 * Fix vs. previous implementation: date-only strings (YYYY-MM-DD) are parsed by
 * the JS Date constructor as UTC midnight, but campaign dates are local midnight.
 * In AEST (UTC+10) the 10-hour gap caused boundary-day campaigns to be incorrectly
 * excluded. Appending 'T00:00:00' forces local-time parsing.
 */
function isDateInRange(date: Date, startDate: string | null, endDate: string | null): boolean {
  if (startDate && date < new Date(startDate + 'T00:00:00')) return false;
  if (endDate   && date > new Date(endDate   + 'T00:00:00')) return false;
  return true;
}

/**
 * Returns true if `date` appears in the rule's exceptions list.
 */
function isDateExcepted(date: Date, ruleConfig: RuleConfig): boolean {
  if (!ruleConfig?.exceptions?.length) return false;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return ruleConfig.exceptions.includes(`${y}-${m}-${d}`);
}

/**
 * Evaluate a single rule and return generated campaign records for the given period.
 */
export function evaluateRule(
  rule: CampaignRule,
  targetStartDate: Date,
  targetEndDate: Date
): GeneratedCampaign[] {
  if (!rule.is_active) return [];

  let matchingDates: Date[] = [];

  switch (rule.frequency_type) {
    case 'monthly':
      // Both fields are required; month_day_of_week was made required in the UI
      // (was previously optional and silently fell back to Monday).
      if (rule.month_week_number === null || rule.month_day_of_week === null) return [];
      matchingDates = findMonthlyOccurrences(
        rule.month_week_number,
        rule.month_day_of_week,
        targetStartDate,
        targetEndDate
      );
      break;

    case 'biweekly': {
      if (rule.day_of_week === null || rule.frequency_value === null) return [];
      const refDate = rule.rule_config?.reference_date ?? null;
      matchingDates = findBiweeklyOccurrences(
        rule.frequency_value,
        rule.day_of_week,
        targetStartDate,
        targetEndDate,
        refDate
      );
      break;
    }

    case 'weekly':
      if (rule.day_of_week === null) return [];
      matchingDates = findWeeklyOccurrences(
        rule.day_of_week,
        targetStartDate,
        targetEndDate
      );
      break;

    case 'custom':
      // 'custom' rules are no longer creatable via the UI and cannot generate campaigns.
      // Legacy rows of this type are preserved in the DB but silently skipped here.
      return [];

    default:
      return [];
  }

  // Filter by the rule's own active date window and exception list.
  const validDates = matchingDates.filter(
    date => isDateInRange(date, rule.start_date, rule.end_date) && !isDateExcepted(date, rule.rule_config)
  );

  // Build campaign records.
  return validDates.map(date => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    const overrideFields = rule.rule_config?.override_fields?.[dateStr] ?? {};

    return {
      date:     dateStr,
      state:    rule.state,
      place:    rule.place,
      time:     typeof overrideFields.time === 'string' ? overrideFields.time : rule.time,
      leader:   rule.leader,
      mobile:   rule.mobile,
      category: 'TWOL',
      rule_id:  rule.id,
    };
  });
}

/**
 * Evaluate multiple rules for a period and return deduplicated campaigns.
 * Conflicts (same date/state/place/time) are resolved by priority — higher wins.
 */
export function evaluateRules(
  rules: CampaignRule[],
  targetStartDate: Date,
  targetEndDate: Date
): GeneratedCampaign[] {
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
  const seen = new Map<string, GeneratedCampaign>();
  const all: GeneratedCampaign[] = [];

  for (const rule of sortedRules) {
    for (const campaign of evaluateRule(rule, targetStartDate, targetEndDate)) {
      const key = `${campaign.date}_${campaign.state}_${campaign.place}_${campaign.time}`;
      if (!seen.has(key)) {
        seen.set(key, campaign);
        all.push(campaign);
      }
    }
  }

  return all;
}

/**
 * Preview rule evaluation for a date range.
 * Returns both the raw Date objects and the full GeneratedCampaign records.
 */
export function previewRuleEvaluation(
  rule: CampaignRule,
  previewStartDate: Date,
  previewEndDate: Date
): { dates: Date[]; campaigns: GeneratedCampaign[] } {
  const campaigns = evaluateRule(rule, previewStartDate, previewEndDate);
  const dates = campaigns.map(c => new Date(c.date + 'T00:00:00'));
  return { dates, campaigns };
}
