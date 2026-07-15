/**
 * Splits/joins the numeric "site" suffix that distinguishes multiple locations
 * sharing the same place name (e.g. "Orange 1", "Orange 2", "Frankston 2").
 * Single source of truth so the parsing rule stays consistent between the
 * one-off data migration and every place selector/display in the app.
 */

/** Parses a raw place string like "Orange 1" into its base place and site. */
export function splitPlaceAndSite(raw: string): { place: string; site: string } {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  const match = collapsed.match(/^(.*\S)\s+(\d+)$/);
  if (match) return { place: match[1], site: match[2] };
  return { place: collapsed, site: '' };
}

/** Joins a base place and site back into the combined display label. */
export function combinePlaceAndSite(place: string, site: string): string {
  return site ? `${place} ${site}` : place;
}
