/**
 * Shared utility functions for campaign data formatting and parsing
 */

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
