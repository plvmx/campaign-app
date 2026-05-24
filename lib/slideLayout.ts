/**
 * Shared constants and helpers for campaign slide layout (JPEG slides and HTML list).
 * Keeps slide-style state colors (RGB) and formatting in one place.
 */

export const SLIDE_STATE_COLORS: Record<string, string> = {
  ACT: 'rgb(0, 176, 240)',
  NSW: 'rgb(0, 0, 0)',
  NT: 'rgb(0, 46, 138)',
  QLD: 'rgb(255, 0, 0)',
  SA: 'rgb(0, 176, 80)',
  TAS: 'rgb(0, 0, 255)',
  VIC: 'rgb(234, 107, 20)',
  WA: 'rgb(204, 0, 255)',
};

export const STATE_CODES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

export const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getSlideStateColor(state: string): string {
  const upper = state.toUpperCase();
  return SLIDE_STATE_COLORS[upper] ?? 'rgb(0, 0, 0)';
}

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  const last = day % 10;
  switch (last) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function formatSlideDateText(date: Date): string {
  const jsDay = date.getDay();
  const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
  const dayName = DAY_NAMES[dayIndex];
  const dayNum = date.getDate();
  const ordinal = getOrdinalSuffix(dayNum);
  const monthName = MONTH_NAMES[date.getMonth()];
  return `${dayName} ${dayNum}${ordinal} ${monthName}`;
}

export function getSlideDateHeadings(customStartDate?: string): Date[] {
  const today = new Date();
  const currentWeekday = today.getDay();
  const pythonWeekday = currentWeekday === 0 ? 6 : currentWeekday - 1;

  let startDate: Date;
  if (customStartDate) {
    const [y, m, d] = customStartDate.split('-').map(Number);
    startDate = new Date(y, m - 1, d);
    startDate.setHours(0, 0, 0, 0);
  } else {
    if (pythonWeekday <= 2) {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - pythonWeekday);
    } else {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() + (7 - pythonWeekday));
    }
  }

  const dates: Date[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}
