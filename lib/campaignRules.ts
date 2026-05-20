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
  frequency_type: 'weekly' | 'biweekly' | 'monthly' | 'custom';
  frequency_value: number | null;
  month_week_number: number | null; // 1-4 or -1 for last week
  month_day_of_week: number | null; // 0=Sunday, 6=Saturday
  day_of_week: number | null; // 0=Sunday, 6=Saturday
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
 * Find all dates matching a monthly pattern
 */
function findMonthlyOccurrences(
  weekNumber: number,
  dayOfWeek: number | null,
  startDate: Date,
  endDate: Date
): Date[] {
  const matches: Date[] = [];
  const current = new Date(startDate);
  current.setDate(1); // Start from first day of month
  
  // If start date is not the first, move to the start date's month
  if (current < startDate) {
    current.setMonth(current.getMonth() + 1);
  }
  
  while (current <= endDate) {
    const year = current.getFullYear();
    const month = current.getMonth();
    
    // Get all days in the target week
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();
    
    let targetDate: Date | null = null;
    
    if (weekNumber === -1) {
      // Last week of month
      const lastDay = new Date(year, month + 1, 0);
      const lastDayOfWeek = lastDay.getDay();
      const lastWeekStart = new Date(lastDay);
      lastWeekStart.setDate(lastDay.getDate() - lastDayOfWeek);
      
      if (dayOfWeek !== null) {
        targetDate = new Date(lastWeekStart);
        targetDate.setDate(targetDate.getDate() + dayOfWeek);
        // Make sure it's still in the same month
        if (targetDate.getMonth() !== month) {
          targetDate = null;
        }
      } else {
        // Use the last day of the month
        targetDate = new Date(lastDay);
      }
    } else {
      // Specific week (1-4)
      const weekStart = new Date(year, month, 1);
      const daysToAdd = (weekNumber - 1) * 7 - firstDayOfWeek;
      weekStart.setDate(weekStart.getDate() + daysToAdd);
      
      if (dayOfWeek !== null) {
        targetDate = new Date(weekStart);
        targetDate.setDate(targetDate.getDate() + dayOfWeek);
      } else {
        // Use the first day of that week (Monday)
        targetDate = new Date(weekStart);
        // Adjust to Monday if needed
        const dayOfWeekStart = weekStart.getDay();
        const daysToMonday = dayOfWeekStart === 0 ? 6 : dayOfWeekStart - 1;
        targetDate.setDate(targetDate.getDate() - daysToMonday);
      }
      
      // Make sure the date is still in the target month
      if (targetDate.getMonth() !== month) {
        targetDate = null;
      }
    }
    
    if (targetDate && targetDate >= startDate && targetDate <= endDate) {
      matches.push(new Date(targetDate));
    }
    
    // Move to next month
    current.setMonth(current.getMonth() + 1);
  }
  
  return matches;
}

/**
 * Find all dates matching a weekly pattern
 */
function findWeeklyOccurrences(
  dayOfWeek: number,
  startDate: Date,
  endDate: Date
): Date[] {
  const matches: Date[] = [];
  const current = new Date(startDate);
  
  // Find the first occurrence of the target day of week
  const currentDayOfWeek = current.getDay();
  let daysToAdd = dayOfWeek - currentDayOfWeek;
  if (daysToAdd < 0) {
    daysToAdd += 7;
  }
  current.setDate(current.getDate() + daysToAdd);
  
  while (current <= endDate) {
    matches.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  
  return matches;
}

/**
 * Find all dates matching a biweekly pattern
 */
function findBiweeklyOccurrences(
  frequencyValue: number,
  dayOfWeek: number,
  startDate: Date,
  endDate: Date,
  referenceDate: string | null
): Date[] {
  const matches: Date[] = [];
  
  // Normalize dates to midnight (local time) to avoid timezone issues
  const normalizedStartDate = new Date(startDate);
  normalizedStartDate.setHours(0, 0, 0, 0);
  const normalizedEndDate = new Date(endDate);
  normalizedEndDate.setHours(23, 59, 59, 999);
  
  // Calculate the next occurrence
  let nextOccurrence: Date;
  
  if (referenceDate) {
    // Reference date exists - it should already be on the correct day of week
    // Parse reference date string (YYYY-MM-DD format) in local timezone
    const [year, month, day] = referenceDate.split('-').map(Number);
    const refDate = new Date(year, month - 1, day);
    refDate.setHours(0, 0, 0, 0);
    
    // Verify the reference date is on the correct day of week
    // If it's not, adjust it (this shouldn't happen, but handle it gracefully)
    if (refDate.getDay() !== dayOfWeek) {
      // Reference date is not on the expected day - adjust it
      const currentDay = refDate.getDay();
      const daysToAdd = (dayOfWeek - currentDay + 7) % 7;
      refDate.setDate(refDate.getDate() + daysToAdd);
    }
    
    // Next occurrence is exactly frequencyValue weeks after the reference date
    // Use milliseconds to ensure precise calculation
    const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;
    nextOccurrence = new Date(refDate.getTime() + (frequencyValue * millisecondsPerWeek));
  } else {
    // No reference date - find the first occurrence of the target day in the target period
    const baseDate = new Date(normalizedStartDate);
    baseDate.setHours(0, 0, 0, 0);
    
    // Find the first occurrence of the target day of week from start date
    const baseDayOfWeek = baseDate.getDay();
    let daysToAdd = dayOfWeek - baseDayOfWeek;
    if (daysToAdd < 0) {
      daysToAdd += 7;
    }
    baseDate.setDate(baseDate.getDate() + daysToAdd);
    
    // Verify we're on the correct day of week
    if (baseDate.getDay() !== dayOfWeek) {
      const currentDay = baseDate.getDay();
      const correction = (dayOfWeek - currentDay + 7) % 7;
      baseDate.setDate(baseDate.getDate() + correction);
    }
    
    nextOccurrence = new Date(baseDate);
  }
  
  nextOccurrence.setHours(0, 0, 0, 0);
  
  // Verify the calculated date is on the correct day of week
  if (nextOccurrence.getDay() !== dayOfWeek) {
    // This should never happen, but if it does, log and fix it
    console.warn(`Calculated date ${nextOccurrence.toISOString()} is not on day ${dayOfWeek}, correcting...`);
    const currentDay = nextOccurrence.getDay();
    const correction = (dayOfWeek - currentDay + 7) % 7;
    nextOccurrence.setDate(nextOccurrence.getDate() + correction);
  }
  
  // Only add if the next occurrence is within the target period
  if (nextOccurrence >= normalizedStartDate && nextOccurrence <= normalizedEndDate) {
    matches.push(new Date(nextOccurrence));
  }
  
  return matches;
}

/**
 * Evaluate a custom pattern from rule_config
 */
function evaluateCustomPattern(
  ruleConfig: RuleConfig,
  _startDate: Date,
  _endDate: Date
): Date[] {
  // For now, return empty array - can be extended later
  // This allows for future complex patterns via JSONB
  if (ruleConfig?.exceptions) {
    // Handle exceptions
  }
  
  return [];
}

/**
 * Check if a date is within the rule's active date range
 */
function isDateInRange(date: Date, startDate: string | null, endDate: string | null): boolean {
  if (startDate && date < new Date(startDate)) {
    return false;
  }
  if (endDate && date > new Date(endDate)) {
    return false;
  }
  return true;
}

/**
 * Check if a date is in the exceptions list
 */
function isDateExcepted(date: Date, ruleConfig: RuleConfig): boolean {
  if (!ruleConfig?.exceptions) {
    return false;
  }
  
  // Format date in local timezone (not UTC) to avoid day shifts
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  return ruleConfig.exceptions.includes(dateStr);
}

/**
 * Evaluate a single rule and generate campaign dates
 * For biweekly rules, this will use the reference_date if set, or check existing campaigns
 */
export function evaluateRule(
  rule: CampaignRule,
  targetStartDate: Date,
  targetEndDate: Date
): GeneratedCampaign[] {
  if (!rule.is_active) {
    return [];
  }
  
  let matchingDates: Date[] = [];
  
  switch (rule.frequency_type) {
    case 'monthly':
      if (rule.month_week_number === null) {
        return [];
      }
      matchingDates = findMonthlyOccurrences(
        rule.month_week_number,
        rule.month_day_of_week,
        targetStartDate,
        targetEndDate
      );
      break;
      
    case 'biweekly':
      if (rule.day_of_week === null || rule.frequency_value === null) {
        return [];
      }
      // Use reference_date from rule_config if set
      const refDate = rule.rule_config?.reference_date || null;
      matchingDates = findBiweeklyOccurrences(
        rule.frequency_value,
        rule.day_of_week,
        targetStartDate,
        targetEndDate,
        refDate
      );
      break;
      
    case 'weekly':
      if (rule.day_of_week === null) {
        return [];
      }
      matchingDates = findWeeklyOccurrences(
        rule.day_of_week,
        targetStartDate,
        targetEndDate
      );
      break;
      
    case 'custom':
      matchingDates = evaluateCustomPattern(
        rule.rule_config,
        targetStartDate,
        targetEndDate
      );
      break;
      
    default:
      return [];
  }
  
  // Filter by date range constraints and exceptions
  const validDates = matchingDates.filter(date => {
    if (!isDateInRange(date, rule.start_date, rule.end_date)) {
      return false;
    }
    if (isDateExcepted(date, rule.rule_config)) {
      return false;
    }
    return true;
  });
  
  // Generate campaign records
  return validDates.map(date => {
    // Format date in local timezone (not UTC) to avoid day shifts
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    // Check for field overrides in rule_config
    const overrideFields = rule.rule_config?.override_fields?.[dateStr] || {};
    
    return {
      date: dateStr,
      state: rule.state,
      place: rule.place,
      time: typeof overrideFields.time === 'string' ? overrideFields.time : rule.time,
      leader: rule.leader,
      mobile: rule.mobile,
      category: 'TWOL',
      rule_id: rule.id,
    };
  });
}

/**
 * Evaluate multiple rules and generate campaigns
 * Handles conflicts by priority (higher priority wins)
 */
export function evaluateRules(
  rules: CampaignRule[],
  targetStartDate: Date,
  targetEndDate: Date
): GeneratedCampaign[] {
  // Sort rules by priority (higher first)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
  
  const allCampaigns: GeneratedCampaign[] = [];
  const conflictMap = new Map<string, GeneratedCampaign>(); // key: date_state_place_time
  
  for (const rule of sortedRules) {
    const campaigns = evaluateRule(rule, targetStartDate, targetEndDate);
    
    for (const campaign of campaigns) {
      const conflictKey = `${campaign.date}_${campaign.state}_${campaign.place}_${campaign.time}`;
      
      // If there's a conflict, higher priority rule wins (we're already sorted by priority)
      if (!conflictMap.has(conflictKey)) {
        conflictMap.set(conflictKey, campaign);
        allCampaigns.push(campaign);
      }
    }
  }
  
  return allCampaigns;
}

/**
 * Preview rule evaluation for a date range
 */
export function previewRuleEvaluation(
  rule: CampaignRule,
  previewStartDate: Date,
  previewEndDate: Date
): { dates: Date[]; campaigns: GeneratedCampaign[] } {
  const campaigns = evaluateRule(rule, previewStartDate, previewEndDate);
  const dates = campaigns.map(c => new Date(c.date));
  
  return { dates, campaigns };
}
