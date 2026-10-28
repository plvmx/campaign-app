/**
 * Rough bounding boxes for each Australian state/territory, used to reject a
 * geocoding result that landed in the wrong state (Nominatim happily returns
 * a same-named suburb elsewhere, e.g. Brisbane's "Brighton" for a Victorian
 * place). Each box is a simple rectangle, so it catches a result hundreds of
 * kilometres away in another state but NOT one just across a shared border
 * (the boxes overlap there — Canberra falls inside Victoria's); it is a
 * sanity check, not a boundary test.
 */
const BOUNDS: Record<string, { south: number; north: number; west: number; east: number }> = {
  NSW: { south: -37.6, north: -28.1, west: 140.9, east: 153.8 },
  VIC: { south: -39.3, north: -33.9, west: 140.9, east: 150.1 },
  QLD: { south: -29.2, north: -9.0, west: 137.9, east: 153.8 },
  SA: { south: -38.2, north: -25.9, west: 129.0, east: 141.1 },
  WA: { south: -35.2, north: -13.6, west: 112.8, east: 129.1 },
  TAS: { south: -43.8, north: -39.4, west: 143.7, east: 148.7 },
  NT: { south: -26.1, north: -10.9, west: 128.9, east: 138.1 },
  ACT: { south: -36.0, north: -35.1, west: 148.7, east: 149.5 },
};

/** True when the point lies inside the state's box; true for a state we have no box for, so unknown codes never reject. */
export function isWithinState(latitude: number, longitude: number, state: string): boolean {
  const b = BOUNDS[state.toUpperCase()];
  if (!b) return true;
  return latitude >= b.south && latitude <= b.north && longitude >= b.west && longitude <= b.east;
}
