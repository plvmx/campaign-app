/**
 * Campaign Date Management
 * 
 * Calculates and manages global campaign dates based on the current day of the week.
 */

export interface CampaignDates {
  pastCampaignStart: Date;
  upcomingCampaignStart: Date;
  secondWeekStart: Date;
}

/**
 * Get the Monday of a given week
 * @param date - Reference date
 * @param weeksOffset - Number of weeks to offset (negative for previous weeks, positive for future weeks)
 */
function getMondayOfWeek(date: Date, weeksOffset: number = 0): Date {
  const result = new Date(date);
  const dayOfWeek = result.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  
  // Calculate days to subtract to get to Monday
  // If Sunday (0), go back 6 days; if Monday (1), go back 0 days; if Tuesday (2), go back 1 day, etc.
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  
  result.setDate(result.getDate() - daysToMonday + (weeksOffset * 7));
  result.setHours(0, 0, 0, 0);
  
  return result;
}

/**
 * Calculate campaign dates based on the current date
 * 
 * Logic:
 * 1. Past Campaign Start:
 *    - Thursday to Sunday (4-0): Monday of current week
 *    - Monday to Wednesday (1-3): Monday of previous week
 * 
 * 2. Upcoming Campaign Start:
 *    - Monday to Wednesday (1-3): Monday of current week
 *    - Thursday to Sunday (4-0): Monday of next week
 * 
 * 3. Second Week Start:
 *    - Monday after Upcoming Campaign Start
 */
export function calculateCampaignDates(referenceDate: Date = new Date()): CampaignDates {
  const dayOfWeek = referenceDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  
  let pastCampaignStart: Date;
  let upcomingCampaignStart: Date;
  
  // Determine Past Campaign Start
  if (dayOfWeek >= 4 || dayOfWeek === 0) {
    // Thursday to Sunday: Monday of current week
    pastCampaignStart = getMondayOfWeek(referenceDate, 0);
  } else {
    // Monday to Wednesday: Monday of previous week
    pastCampaignStart = getMondayOfWeek(referenceDate, -1);
  }
  
  // Determine Upcoming Campaign Start
  if (dayOfWeek >= 1 && dayOfWeek <= 3) {
    // Monday to Wednesday: Monday of current week
    upcomingCampaignStart = getMondayOfWeek(referenceDate, 0);
  } else {
    // Thursday to Sunday: Monday of next week
    upcomingCampaignStart = getMondayOfWeek(referenceDate, 1);
  }
  
  // Second Week Start: Monday after Upcoming Campaign Start
  const secondWeekStart = new Date(upcomingCampaignStart);
  secondWeekStart.setDate(secondWeekStart.getDate() + 7);
  
  return {
    pastCampaignStart,
    upcomingCampaignStart,
    secondWeekStart,
  };
}

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDateForDb(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a date as a readable string (e.g., "Mon, Jan 15, 2026")
 */
export function formatDateReadable(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get the current campaign dates as formatted strings
 */
export function getCampaignDatesFormatted() {
  const dates = calculateCampaignDates();
  
  return {
    pastCampaignStart: formatDateForDb(dates.pastCampaignStart),
    upcomingCampaignStart: formatDateForDb(dates.upcomingCampaignStart),
    secondWeekStart: formatDateForDb(dates.secondWeekStart),
    pastCampaignStartReadable: formatDateReadable(dates.pastCampaignStart),
    upcomingCampaignStartReadable: formatDateReadable(dates.upcomingCampaignStart),
    secondWeekStartReadable: formatDateReadable(dates.secondWeekStart),
  };
}

/**
 * Check if a date is in the past campaigns period
 */
export function isInPastPeriod(campaignDate: Date | string): boolean {
  const dates = calculateCampaignDates();
  const dateObj = typeof campaignDate === 'string' ? new Date(campaignDate) : campaignDate;
  dateObj.setHours(0, 0, 0, 0);
  
  return dateObj < dates.upcomingCampaignStart;
}

/**
 * Check if a date is in the upcoming campaigns period (current 2-week period)
 */
export function isInUpcomingPeriod(campaignDate: Date | string): boolean {
  const dates = calculateCampaignDates();
  const dateObj = typeof campaignDate === 'string' ? new Date(campaignDate) : campaignDate;
  dateObj.setHours(0, 0, 0, 0);
  
  const endOfSecondWeek = new Date(dates.secondWeekStart);
  endOfSecondWeek.setDate(endOfSecondWeek.getDate() + 6); // End of second week (Sunday)
  
  return dateObj >= dates.upcomingCampaignStart && dateObj <= endOfSecondWeek;
}
