'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import type { MapMarker } from '@/lib/services/campaignMapService';
import { getStateMarkerIcon } from '@/lib/leafletMarkerIcon';
import { formatCampaignDateTimeDisplay, getEarliestCampaign } from '@/lib/campaignUtils';
import MapPopupActions from '@/components/MapPopupActions';

interface FlyToProps {
  center: [number, number];
  zoom: number;
}

/** Animates the map to a new center/zoom whenever the target changes (e.g. state selection). */
function FlyTo({ center, zoom }: FlyToProps) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1 });
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
  markers: MapMarker[];
}

export default function CampaignMap({ center, zoom, markers }: CampaignMapProps) {
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
                  <MapPopupActions campaignId={firstCampaign.id} place={marker.place} state={marker.state} />
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
