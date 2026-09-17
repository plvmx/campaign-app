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

// Leaflet icons are immutable once built, so one instance per state+place+size+
// opacity combination can be shared across every marker on the map instead of
// rebuilding an <svg>/label string per marker. Keyed on those too (not just
// state+place) since a caller can now request a different size/opacity (see
// options below) — without that, two callers on the same page (or across
// client-side navigations, since this cache is module-level) requesting
// different sizes for the same state+place would silently collide and one
// would get the other's cached icon.
const iconCache = new Map<string, L.DivIcon>();

const DEFAULT_SIZE = 22;
const DEFAULT_FILL_OPACITY = 0.35;
// Border scales with size (see below) so the ring's proportions stay
// consistent — this is its value at DEFAULT_SIZE.
const DEFAULT_BORDER_WIDTH = 1.5;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface StateMarkerIconOptions {
  /** Overall icon diameter in px. Defaults to 22 (CampaignMap's usual size) — NearbyCampaignsMap passes a larger value so markers are easier to spot and tap on a map meant to be used one-handed on a phone. */
  size?: number;
  /** Fill opacity of the translucent halo ring (0-1). Defaults to 0.35 — NearbyCampaignsMap passes a higher value to make markers read more clearly against the base map. */
  fillOpacity?: number;
}

export function getStateMarkerIcon(state: string, place: string, options: StateMarkerIconOptions = {}): L.DivIcon {
  const upperState = state.trim().toUpperCase();
  const size = options.size ?? DEFAULT_SIZE;
  const fillOpacity = options.fillOpacity ?? DEFAULT_FILL_OPACITY;
  const key = `${upperState}::${place}::${size}::${fillOpacity}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const center = size / 2;
  // Scaled from DEFAULT_BORDER_WIDTH at DEFAULT_SIZE, so a larger marker's
  // ring stays proportionally as thick rather than looking relatively thinner.
  const borderWidth = DEFAULT_BORDER_WIDTH * (size / DEFAULT_SIZE);
  // The centre point is reduced to match the ring's own border thickness — a precise
  // mark rather than a filled-in dot.
  const pointRadius = borderWidth / 2;

  const color = getSlideStateColor(upperState);
  const label = escapeHtml(place);
  const icon = L.divIcon({
    className: 'state-color-marker',
    html: `<div style="position:relative;width:${size}px;height:${size}px;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${center}" cy="${center}" r="${center - 1}" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="${borderWidth}"/>
        <circle cx="${center}" cy="${center}" r="${pointRadius}" fill="${color}"/>
      </svg>
      <span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);white-space:nowrap;font-size:11px;font-weight:600;line-height:1;color:#000;text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff;">${label}</span>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [center, center],
    popupAnchor: [0, -center],
  });
  iconCache.set(key, icon);
  return icon;
}
