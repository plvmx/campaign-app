import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// Leaflet needs a real layout engine; render Popup content inline instead
// so the test can see what a marker's popup would show once opened.
const fitBounds = vi.hoisted(() => vi.fn());

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMap: () => ({ getSize: () => ({ x: 1, y: 1 }), setView: vi.fn(), flyTo: vi.fn(), fitBounds }),
  useMapEvents: () => null,
}));
vi.mock('leaflet', () => ({ default: { latLngBounds: (pts: unknown) => ({ pts }) } }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('@/lib/leafletMarkerIcon', () => ({ getStateMarkerIcon: () => ({}) }));
vi.mock('@/components/techInsights/TechInsightsMapTag', () => ({ default: () => null }));

import CampaignMap from '../CampaignMap';

describe('CampaignMap popup', () => {
  it('lists every campaign at a place, earliest first, each with its own actions', () => {
    render(
      <CampaignMap
        center={[0, 0]}
        zoom={5}
        markers={[{
          state: 'VIC',
          place: 'Geelong',
          latitude: 0,
          longitude: 0,
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
    expect(screen.getByText('Leader: Sam')).toBeTruthy();
    expect(screen.getByText('Leader: Alex')).toBeTruthy();
  });

  it('frames the map around the markers only when fitToMarkers is set', () => {
    const markers = [{ state: 'VIC', place: 'Geelong', latitude: -38.1, longitude: 144.3 }];
    fitBounds.mockClear();
    render(<CampaignMap center={[0, 0]} zoom={5} markers={markers} />);
    expect(fitBounds).not.toHaveBeenCalled();

    render(<CampaignMap center={[0, 0]} zoom={5} markers={markers} fitToMarkers />);
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });
});
