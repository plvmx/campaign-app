/**
 * Leaflet marker icons tinted by state, using the same palette as the downloaded
 * campaign-list slides (`SLIDE_STATE_COLORS` in lib/slideLayout.ts — also the source
 * the pastel badge colors in lib/stateColors.ts are derived from). Used by every map
 * in the app (Campaign Map, Campaigns Near Me, State Places Map) so a pin's color
 * matches its state at a glance, consistently with slides and badges elsewhere.
 *
 * Only imported by map components that are dynamically loaded with `ssr: false`
 * (CampaignMap, NearbyCampaignsMap) since `leaflet` touches `window` at import time.
 */
import L from 'leaflet';
import { getSlideStateColor } from '@/lib/slideLayout';

// Leaflet icons are immutable once built, so one instance per state can be shared
// across every marker on the map instead of rebuilding an <svg> string per marker.
const iconCache = new Map<string, L.DivIcon>();

export function getStateMarkerIcon(state: string): L.DivIcon {
  const key = state.trim().toUpperCase();
  const cached = iconCache.get(key);
  if (cached) return cached;

  const color = getSlideStateColor(key);
  const icon = L.divIcon({
    className: 'state-color-marker',
    html: `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
      <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.6 12.5 28.5 12.5 28.5S25 22.1 25 12.5C25 5.6 19.4 0 12.5 0z" fill="${color}" stroke="#1f2937" stroke-width="1.25"/>
      <circle cx="12.5" cy="12.5" r="4.5" fill="#fff"/>
    </svg>`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
  iconCache.set(key, icon);
  return icon;
}
