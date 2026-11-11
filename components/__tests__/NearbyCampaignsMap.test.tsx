import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// Leaflet needs a real layout engine; render Popup content inline instead
// so the test can see what a marker's popup would show once opened.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Circle: () => null,
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
}));
vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}), latLngBounds: () => ({}) },
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('@/lib/leafletMarkerIcon', () => ({ getStateMarkerIcon: () => ({}) }));
vi.mock('@/components/techInsights/TechInsightsMapTag', () => ({ default: () => null }));

import NearbyCampaignsMap from '../NearbyCampaignsMap';

describe('NearbyCampaignsMap popup', () => {
  it('lists every campaign at a place, earliest first, each with its own actions', () => {
    render(
      <NearbyCampaignsMap
        center={[0, 0]}
        radiusKm={60}
        markers={[{
          state: 'VIC',
          place: 'Geelong',
          latitude: 0,
          longitude: 0,
          distanceKm: 12,
          campaigns: [
            { id: 'late', date: '2026-10-24', time: '10:00', leader: 'Sam' },
            { id: 'early', date: '2026-10-20', time: '09:00', leader: 'Alex' },
          ],
        }]}
        renderActions={({ campaignId }) => <span data-testid="actions">{campaignId}</span>}
      />,
    );

    expect(screen.getAllByTestId('map-popup-campaign')).toHaveLength(2);
    expect(screen.getAllByTestId('actions').map(el => el.textContent)).toEqual(['early', 'late']);
  });
});
