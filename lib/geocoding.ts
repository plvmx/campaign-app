/**
 * Thin wrapper around the free Nominatim (OpenStreetMap) geocoding API.
 * Nominatim's usage policy caps requests at 1/sec, so callers must serialize lookups.
 */

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

/** Geocode a "place, state" pair within Australia. Returns null if no match is found. */
export async function geocodePlace(place: string, state: string): Promise<GeocodeResult | null> {
  const query = `${place}, ${state}, Australia`;
  return queryNominatim(query);
}

export interface AddressGeocodeResult extends GeocodeResult {
  /** Human-readable address Nominatim resolved the query to — useful for confirming the match. */
  displayName: string;
}

/**
 * Geocode an arbitrary free-form address within Australia.
 * Used by the "Campaigns Near Me" map when the user types an address instead of
 * relying on browser geolocation.
 */
export async function geocodeAddress(address: string): Promise<AddressGeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(address)}`;

  const response = await fetch(url, {
    headers: {
      'Accept-Language': 'en',
      'User-Agent': 'campaign-app (campaigns near me feature)',
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response || !response.ok) return null;

  const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (results.length === 0) return null;

  const { lat, lon, display_name } = results[0];
  return { latitude: parseFloat(lat), longitude: parseFloat(lon), displayName: display_name };
}

async function queryNominatim(query: string): Promise<GeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'Accept-Language': 'en',
      // Nominatim's usage policy requires a descriptive User-Agent identifying the app.
      'User-Agent': 'campaign-app (admin campaign map feature)',
    },
    // Guards against a slow or unreachable Nominatim from hanging the map indefinitely.
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response || !response.ok) return null;

  const results = (await response.json()) as Array<{ lat: string; lon: string }>;
  if (results.length === 0) return null;

  const { lat, lon } = results[0];
  return { latitude: parseFloat(lat), longitude: parseFloat(lon) };
}
