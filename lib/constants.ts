/**
 * Shared application constants
 */

/** Australian state/territory codes used throughout the app */
export const AUSTRALIAN_STATES = ['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NT'] as const;

export type AustralianState = (typeof AUSTRALIAN_STATES)[number];

/** All Supabase tables tracked by the metrics dashboard */
export const DATABASE_TABLES = [
  'campaigns',
  'state_leaders',
  'results',
  'campaign_changes_log',
  'app_events',
  'campaign_rules',
  'campaign_categories',
] as const;
