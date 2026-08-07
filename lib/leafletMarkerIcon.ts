/**
 * Leaflet marker icons tinted by state, using the same palette as the downloaded
 * campaign-list slides (`SLIDE_STATE_COLORS` in lib/slideLayout.ts — also the source
 * the pastel badge colors in lib/stateColors.ts are derived from). Used by every map
 * in the app (Campaign Map, Campaigns Near Me, State Places Map) so a pin's color
 * matches its state at a glance, consistently with slides and badges elsewhere.
 *
 * Rendered as a translucent halo with a solid dot at its centre — unlike a teardrop
 * pin, the icon's own centre point *is* the location, so `iconAnchor` is the circle's
 * centre rather than its bottom tip.
 *
 * Only imported by map components that are dynamically loaded with `ssr: false`
 * (CampaignMap, NearbyCampaignsMap) since `leaflet` touches `window` at import time.
 */
import L from 'leaflet';
import { getSlideStateColor } from '@/lib/slideLayout';

// Leaflet icons are immutable once built, so one instance per state can be shared
// across every marker on the map instead of rebuilding an <svg> string per marker.
const iconCache = new Map<string, L.DivIcon>();

const SIZE = 22;
const CENTER = SIZE / 2;

export function getStateMarkerIcon(state: string): L.DivIcon {
  const key = state.trim().toUpperCase();
  const cached = iconCache.get(key);
  if (cached) return cached;

  const color = getSlideStateColor(key);
  const icon = L.divIcon({
    className: 'state-color-marker',
    html: `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${CENTER}" cy="${CENTER}" r="${CENTER - 1}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.5"/>
      <circle cx="${CENTER}" cy="${CENTER}" r="4" fill="${color}"/>
    </svg>`,
    iconSize: [SIZE, SIZE],
    iconAnchor: [CENTER, CENTER],
    popupAnchor: [0, -CENTER],
  });
  iconCache.set(key, icon);
  return icon;
}
