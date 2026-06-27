'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { MapMarker } from '@/lib/services/campaignMapService';

// Leaflet's default marker icon assets don't resolve correctly through Next.js's
// bundler, so they're served from /public/leaflet instead (also keeps them same-origin
// for the CSP img-src policy).
const markerIcon = L.icon({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

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
      {markers.map(marker => (
        <Marker key={`${marker.state}::${marker.place}`} position={[marker.latitude, marker.longitude]} icon={markerIcon}>
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{marker.place}, {marker.state}</p>
              <p className="mt-1">{marker.campaigns.length} upcoming campaign{marker.campaigns.length === 1 ? '' : 's'}</p>
              <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-4">
                {marker.campaigns.map(c => (
                  <li key={c.id}>
                    {c.date} · {c.time} · {c.leader}
                  </li>
                ))}
              </ul>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
