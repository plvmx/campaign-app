'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { MapMarker } from '@/lib/services/campaignMapService';

// Leaflet's default marker icon assets don't resolve correctly through Next.js's
// bundler, so point them at a CDN instead of bundling the package's image files.
const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
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
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
