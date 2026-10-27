'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Tech Insights tag for a Leaflet map. `<MapContainer>` renders its own div and
 * does not forward `data-*` props, so this child sets the attribute on that
 * container element instead (render it inside the MapContainer).
 */
export default function TechInsightsMapTag({ 'data-ti': tag }: { 'data-ti': string }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    container.setAttribute('data-ti', tag);
    return () => container.removeAttribute('data-ti');
  }, [map, tag]);
  return null;
}
