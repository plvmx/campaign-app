'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { NearbyMapMarker } from '@/lib/services/nearbyCampaignsService';

// Default marker icon — Leaflet's bundled assets don't resolve through Next.js's
// bundler, so they're served from /public/leaflet (same-origin for CSP).
const campaignIcon = L.icon({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// Distinct centre marker drawn as a CSS pin so it can't be confused with a campaign.
const centerIcon = L.divIcon({
  className: 'nearby-center-marker',
  html:
    '<div style="width:18px;height:18px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 0 0 1px #000;"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

interface FitBoundsProps {
  center: [number, number];
  radiusKm: number;
}

/**
 * Frames the map so the user's centre, the 60 km radius circle, and all
 * campaign markers are visible. Re-runs whenever the centre changes (new
 * geolocation fix or address lookup) so the view stays in sync.
 */
function FitBounds({ center, radiusKm }: FitBoundsProps) {
  const map = useMap();
  useEffect(() => {
    // 1 degree of latitude is ~111 km; longitude scales with cos(lat).
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.max(0.1, Math.cos((center[0] * Math.PI) / 180)));
    const bounds = L.latLngBounds(
      [center[0] - latDelta, center[1] - lngDelta],
      [center[0] + latDelta, center[1] + lngDelta],
    );
    // Zero padding so the radius circle pushes right up to the edge of whichever
    // dimension is the constraining one — the circle stays fully visible but the
    // map area outside it is minimised.
    map.fitBounds(bounds, { padding: [0, 0], animate: false });
  }, [map, center, radiusKm]);
  return null;
}

interface NearbyCampaignsMapProps {
  center: [number, number];
  radiusKm: number;
  markers: NearbyMapMarker[];
}

/**
 * Static (non-interactive) map of campaigns near a centre point.
 * Panning, zoom, scroll-wheel, double-click and keyboard navigation are all
 * disabled — the map is meant to be read like an image, not explored.
 */
export default function NearbyCampaignsMap({ center, radiusKm, markers }: NearbyCampaignsMapProps) {
  const radiusMeters = useMemo(() => radiusKm * 1000, [radiusKm]);

  return (
    <MapContainer
      center={center}
      zoom={9}
      // Allow fractional zoom levels so fitBounds can land the 60 km circle
      // tight against the viewport edge instead of rounding down to the next
      // whole zoom level and leaving a wide margin around the circle.
      zoomSnap={0}
      zoomDelta={0.25}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      boxZoom={false}
      keyboard={false}
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="/api/tiles/{z}/{x}/{y}"
      />
      <FitBounds center={center} radiusKm={radiusKm} />
      <Circle
        center={center}
        radius={radiusMeters}
        pathOptions={{ color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.08 }}
      />
      <Marker position={center} icon={centerIcon}>
        <Popup>
          <div className="text-sm">
            <p className="font-semibold">You are here</p>
            <p className="mt-1">Showing campaigns within {radiusKm} km</p>
          </div>
        </Popup>
      </Marker>
      {markers.map(marker => (
        <Marker
          key={`${marker.state}::${marker.place}`}
          position={[marker.latitude, marker.longitude]}
          icon={campaignIcon}
        >
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{marker.place}, {marker.state}</p>
              <p className="mt-1">{marker.distanceKm} km away · {marker.campaigns.length} campaign{marker.campaigns.length === 1 ? '' : 's'}</p>
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
