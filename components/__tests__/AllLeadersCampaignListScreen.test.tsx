import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AllLeadersCampaignListScreen from '../AllLeadersCampaignListScreen';

vi.mock('@/components/PublicCampaignList', () => ({
  default: ({ campaigns }: { campaigns: unknown[] }) => <div>list of {campaigns.length}</div>,
}));
vi.mock('@/lib/slideGenerator', () => ({ generateAndDownloadSlidesFromData: vi.fn() }));

describe('AllLeadersCampaignListScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ days: [{ campaigns: [{}, {}] }, { campaigns: [{}] }] }),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the fortnight list with Download a Copy and a way back', async () => {
    const onClose = vi.fn();
    render(<AllLeadersCampaignListScreen onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('list of 3')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Download a Copy' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Return to the previous page/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
