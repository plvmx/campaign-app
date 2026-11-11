import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CampaignReportingMovedClient from '../CampaignReportingMovedClient';

describe('CampaignReportingMovedClient', () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.clear();
  });

  it('explains the move, the steps and links to the sign-in screen', () => {
    render(<CampaignReportingMovedClient />);
    expect(screen.getByAltText('The Way of Life')).toBeTruthy();
    expect(screen.getByText(/must now be done in the TWOL CAS App/i)).toBeTruthy();
    expect(screen.getByText(/green Record Results button/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /app sign-in/i }).getAttribute('href')).toBe('/login');
  });

  it('counts the visit once per browser session', async () => {
    const { unmount } = render(<CampaignReportingMovedClient />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/public/legacy-report-visit');
    unmount();
    render(<CampaignReportingMovedClient />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
