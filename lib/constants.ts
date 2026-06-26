/**
 * Shared application constants
 */

/** Australian state/territory codes used throughout the app */
export const AUSTRALIAN_STATES = ['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NT'] as const;

export type AustralianState = (typeof AUSTRALIAN_STATES)[number];

/** Default map view centered on Australia. */
export const AUSTRALIA_MAP_CENTER: { lat: number; lng: number; zoom: number } = {
  lat: -25.2744,
  lng: 133.7751,
  zoom: 4,
};

/** Center + zoom level to fly the map to when a state is selected. */
export const STATE_MAP_CENTERS: Record<AustralianState, { lat: number; lng: number; zoom: number }> = {
  ACT: { lat: -35.4735, lng: 149.0124, zoom: 10 },
  NSW: { lat: -32.0, lng: 147.0, zoom: 6 },
  QLD: { lat: -22.0, lng: 144.5, zoom: 5 },
  SA: { lat: -30.0, lng: 135.5, zoom: 5 },
  TAS: { lat: -41.9, lng: 146.6, zoom: 7 },
  VIC: { lat: -37.0, lng: 144.5, zoom: 6 },
  WA: { lat: -25.5, lng: 122.0, zoom: 4 },
  NT: { lat: -19.5, lng: 133.5, zoom: 5 },
};

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
