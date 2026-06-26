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
