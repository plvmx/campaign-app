/**
 * Get user's location and convert to Australian state code
 * Returns state codes like: VIC, NSW, QLD, SA, WA, TAS, NT, ACT
 */

export type StateCode = 'VIC' | 'NSW' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT';

interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Get user's current location using browser geolocation API
 */
export async function getUserLocation(): Promise<Coordinates | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('Geolocation is not supported by this browser');
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        console.warn('Error getting location:', error.message);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // Cache for 5 minutes
      }
    );
  });
}

/**
 * Convert coordinates to Australian state code using reverse geocoding
 * Uses a free geocoding service (Nominatim) to get state information
 */
export async function getStateFromLocation(
  latitude: number,
  longitude: number
): Promise<StateCode | null> {
  try {
    // Use Nominatim (OpenStreetMap) reverse geocoding API
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10`,
      {
        headers: {
          'User-Agent': 'CampaignApp/1.0', // Required by Nominatim
        },
      }
    );

    if (!response.ok) {
      throw new Error('Geocoding service unavailable');
    }

    const data = await response.json();
    const address = data.address;

    if (!address) {
      return null;
    }

    // Check various address fields for state information
    const state = address.state || address.region || address.state_district || '';
    const stateUpper = state.toUpperCase();

    // Map Australian state names to codes
    const stateMap: Record<string, StateCode> = {
      VICTORIA: 'VIC',
      'NEW SOUTH WALES': 'NSW',
      QUEENSLAND: 'QLD',
      'SOUTH AUSTRALIA': 'SA',
      'WESTERN AUSTRALIA': 'WA',
      TASMANIA: 'TAS',
      'NORTHERN TERRITORY': 'NT',
      'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
      ACT: 'ACT',
    };

    // Check if we have a direct match
    if (stateMap[stateUpper]) {
      return stateMap[stateUpper];
    }

    // Check for partial matches
    for (const [key, code] of Object.entries(stateMap)) {
      if (stateUpper.includes(key) || key.includes(stateUpper)) {
        return code;
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting state from location:', error);
    return null;
  }
}

/**
 * Get user's state code from their location
 * Caches the result in localStorage to avoid repeated API calls
 */
export async function getUserStateCode(): Promise<StateCode | null> {
  if (typeof window === 'undefined') return null;

  // Check if we have a cached state code (valid for 24 hours)
  const cached = localStorage.getItem('user_state_code');
  const cachedTime = localStorage.getItem('user_state_code_time');
  
  if (cached && cachedTime) {
    const age = Date.now() - parseInt(cachedTime, 10);
    if (age < 24 * 60 * 60 * 1000) { // 24 hours
      return cached as StateCode;
    }
  }

  // Get location
  const location = await getUserLocation();
  if (!location) {
    return null;
  }

  // Get state code from location
  const stateCode = await getStateFromLocation(
    location.latitude,
    location.longitude
  );

  // Cache the result
  if (stateCode) {
    localStorage.setItem('user_state_code', stateCode);
    localStorage.setItem('user_state_code_time', Date.now().toString());
  }

  return stateCode;
}

/**
 * Get cached state code without making API calls
 */
export function getCachedStateCode(): StateCode | null {
  if (typeof window === 'undefined') return null;

  const cached = localStorage.getItem('user_state_code');
  return cached ? (cached as StateCode) : null;
}

