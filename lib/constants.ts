/**
 * Shared application constants
 */

/** Australian state/territory codes used throughout the app */
export const AUSTRALIAN_STATES = ['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NT'] as const;

export type AustralianState = (typeof AUSTRALIAN_STATES)[number];
