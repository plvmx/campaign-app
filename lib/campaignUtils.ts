/**
 * Shared utility functions for campaign data formatting and parsing
 */
import { formatSlideDateText } from '@/lib/slideLayout';

/**
 * Parse campaign time string (HH:MM or HH:MM:SS or ISO timestamp) and return as display string (e.g. "2:30 PM")
 */
export function formatCampaignTimeDisplay(timeStr: string): string {
  let clean = timeStr;
  if (timeStr.includes('T')) {
    clean = timeStr.split('T')[1]?.split('.')[0] ?? timeStr;
  }
  const [hours, minutes] = (clean || '0:0').split(':');
  const hour = parseInt(hours || '0', 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes ?? '00'} ${ampm}`;
}

/**
 * Check if a campaign's date+time is in the past
 */
export function isCampaignPast(date: string, time: string): boolean {
  const campaignDate = new Date(date);
  let timeStr = time;
  if (timeStr.includes('T')) {
    timeStr = timeStr.split('T')[1]?.split('.')[0] || timeStr;
  }
  const [hours, minutes] = (timeStr || '0:0').split(':').map(Number);
  campaignDate.setHours(hours || 0, minutes || 0, 0, 0);
  return campaignDate < new Date();
}

/**
 * Combines a campaign's date and time into a single readable line, e.g.
 * "Saturday 12th July 10:00 AM" — used in map marker popups to show a
 * campaign's date/time without a separate date/time split.
 */
export function formatCampaignDateTimeDisplay(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dateText = formatSlideDateText(new Date(y, m - 1, d));
  const timeText = formatCampaignTimeDisplay(time);
  return `${dateText} ${timeText}`;
}

/**
 * Returns the chronologically earliest campaign in a list (by date, then
 * time). Used by map marker popups to show only the first upcoming campaign
 * for a location — sorts explicitly rather than trusting array order, since
 * getCampaignsByDateRange only guarantees ordering by date, not by time
 * within a date. Returns undefined for an empty list.
 */
export function getEarliestCampaign<T extends { date: string; time: string }>(campaigns: T[]): T | undefined {
  return campaigns.reduce<T | undefined>((earliest, c) => {
    if (!earliest) return c;
    if (c.date !== earliest.date) return c.date < earliest.date ? c : earliest;
    return c.time < earliest.time ? c : earliest;
  }, undefined);
}
