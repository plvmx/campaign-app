/**
 * Leaflet marker icons tinted by state, using the same palette as the downloaded
 * campaign-list slides (`SLIDE_STATE_COLORS` in lib/slideLayout.ts — also the source
 * the pastel badge colors in lib/stateColors.ts are derived from). Used by every map
 * in the app (Campaign Map, Campaigns Near Me, State Places Map) so a pin's color
 * matches its state at a glance, consistently with slides and badges elsewhere.
 *
 * Rendered as a translucent halo ring around a tiny centre point — the point's
 * diameter matches the ring's own border thickness, so it reads as a precise mark
 * rather than a fat dot — with the place name overlaid in black directly on top of
 * the ring, centred on it (a white outline keeps it legible over darker ring colors
 * like NSW's black). The icon's own centre point *is* the location, so `iconAnchor`
 * is the ring's centre.
 *
 * Only imported by map components that are dynamically loaded with `ssr: false`
 * (CampaignMap, NearbyCampaignsMap) since `leaflet` touches `window` at import time.
 */
import L from 'leaflet';
import { getSlideStateColor } from '@/lib/slideLayout';

// Leaflet icons are immutable once built, so one instance per state+place can be
// shared across every marker on the map instead of rebuilding an <svg>/label string
// per marker. Keyed on place too since the place name is baked into the icon.
const iconCache = new Map<string, L.DivIcon>();

const SIZE = 22;
const CENTER = SIZE / 2;
const BORDER_WIDTH = 1.5;
// The centre point is reduced to match the ring's own border thickness — a precise
// mark rather than a filled-in dot.
const POINT_RADIUS = BORDER_WIDTH / 2;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getStateMarkerIcon(state: string, place: string): L.DivIcon {
  const upperState = state.trim().toUpperCase();
  const key = `${upperState}::${place}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const color = getSlideStateColor(upperState);
  const label = escapeHtml(place);
  const icon = L.divIcon({
    className: 'state-color-marker',
    html: `<div style="position:relative;width:${SIZE}px;height:${SIZE}px;">
      <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${CENTER}" cy="${CENTER}" r="${CENTER - 1}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="${BORDER_WIDTH}"/>
        <circle cx="${CENTER}" cy="${CENTER}" r="${POINT_RADIUS}" fill="${color}"/>
      </svg>
      <span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);white-space:nowrap;font-size:11px;font-weight:600;line-height:1;color:#000;text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff;">${label}</span>
    </div>`,
    iconSize: [SIZE, SIZE],
    iconAnchor: [CENTER, CENTER],
    popupAnchor: [0, -CENTER],
  });
  iconCache.set(key, icon);
  return icon;
}
