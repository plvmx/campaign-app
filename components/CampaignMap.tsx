'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useState, type ReactNode } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { getStateMarkerIcon } from '@/lib/leafletMarkerIcon';
import { formatCampaignDateTimeDisplay, getEarliestCampaign } from '@/lib/campaignUtils';
import MapPopupActions from '@/components/MapPopupActions';

/**
 * Just enough of a campaign for this map's popup (id/date/time/leader) —
 * kept minimal and local rather than requiring the admin-only `Campaign`
 * type campaignMapService.ts's `MapMarker` carries, so the public
 * "Upcoming Campaigns" map (app/public/upcoming-campaigns) — whose
 * campaign rows carry far fewer fields — can use this same component
 * without an awkward cast. A full admin `Campaign` object already
 * structurally satisfies this. Mirrors NearbyCampaignsMap.tsx's identical
 * `NearbyMapPopupCampaign` pattern.
 */
export interface CampaignMapPopupCampaign {
  id: string;
  date: string;
  time: string;
  leader: string;
}

export interface CampaignMapPopupMarker {
  state: string;
  place: string;
  latitude: number;
  longitude: number;
  campaigns?: CampaignMapPopupCampaign[];
}

interface FlyToProps {
  center: [number, number];
  zoom: number;
}

/**
 * Animates the map to a new center/zoom whenever the target changes (e.g.
 * state selection, a "Near Me" lookup). Leaflet doesn't measure a freshly
 * created map's container synchronously — `getSize()` reads 0x0 until the
 * browser has laid it out and Leaflet has picked that up (normally via its
 * own resize observer) — and `flyTo`'s animation does pixel-based math on
 * that size, so calling it too soon (right on mount, before that first
 * measurement) throws "Invalid LatLng (NaN, NaN)" instead of moving the
 * map. `setView` doesn't animate but doesn't need a measured size either,
 * so it's used as a safe fallback whenever the size isn't known yet —
 * `MapContainer`'s own `center`/`zoom` props already position the map
 * correctly on first mount, so this never visibly "jumps".
 */
function FlyTo({ center, zoom }: FlyToProps) {
  const map = useMap();
  useEffect(() => {
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) {
      map.setView(center, zoom);
    } else {
      map.flyTo(center, zoom, { duration: 1 });
    }
  }, [map, center, zoom]);
  return null;
}

/** Surfaces tile load failures directly instead of leaving the admin staring at a blank grey map. */
function TileErrorBanner() {
  const [hasError, setHasError] = useState(false);
  useMapEvents({
    tileerror: () => setHasError(true),
    tileload: () => setHasError(false),
  });

  if (!hasError) return null;
  return (
    <div className="absolute top-2 left-1/2 z-[1000] -translate-x-1/2 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 shadow">
      Map tiles failed to load — check your network connection.
    </div>
  );
}

interface CampaignMapProps {
  center: [number, number];
  zoom: number;
  markers: CampaignMapPopupMarker[];
  /**
   * What to render under the Leader line in a campaign marker's popup —
   * defaults to the admin `MapPopupActions` stub. The public "Upcoming
   * Campaigns" screen (app/public/upcoming-campaigns) passes its own
   * renderer here instead, wired to actually record interest rather than
   * console.log placeholders — same `renderActions` pattern
   * NearbyCampaignsMap.tsx already established.
   */
  renderActions?: (props: { campaignId: string; place: string; state: string }) => ReactNode;
}

export default function CampaignMap({ center, zoom, markers, renderActions = (props) => <MapPopupActions {...props} /> }: CampaignMapProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="/api/tiles/{z}/{x}/{y}"
      />
      <TileErrorBanner />
      <FlyTo center={center} zoom={zoom} />
      {markers.map(marker => {
        const firstCampaign = marker.campaigns ? getEarliestCampaign(marker.campaigns) : undefined;
        return (
          <Marker key={`${marker.state}::${marker.place}`} position={[marker.latitude, marker.longitude]} icon={getStateMarkerIcon(marker.state, marker.place)}>
            <Popup>
              {firstCampaign ? (
                <div className="text-sm">
                  <p className="font-semibold">{marker.place}, {marker.state}</p>
                  <p className="mt-1">{formatCampaignDateTimeDisplay(firstCampaign.date, firstCampaign.time)}</p>
                  <p>Leader: {firstCampaign.leader}</p>
                  {renderActions({ campaignId: firstCampaign.id, place: marker.place, state: marker.state })}
                </div>
              ) : (
                <p className="text-sm font-semibold">{marker.place} {marker.state}</p>
              )}
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
