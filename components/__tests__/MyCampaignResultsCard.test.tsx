import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MyCampaignResultsCard from '../MyCampaignResultsCard';

const fetchResults = vi.fn();
vi.mock('@/lib/services/myCampaignResultsClient', () => ({ fetchMyCampaignResults: () => fetchResults() }));

beforeEach(() => vi.clearAllMocks());

describe('MyCampaignResultsCard', () => {
  it('loads nothing until the leader opens the block', () => {
    render(<MyCampaignResultsCard />);
    expect(fetchResults).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Show my results' })).toBeTruthy();
  });

  it('shows date, location and the four totals', async () => {
    fetchResults.mockResolvedValue([
      { id: 'r1', campaignDate: '2026-10-31', location: 'Orange', partial: 2, full: 1, sinnersPrayers: 0, followUp: null },
    ]);
    render(<MyCampaignResultsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Show my results' }));
    await waitFor(() => expect(screen.getByText('31/10/2026')).toBeTruthy());
    expect(screen.getByText('Orange')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Campaign Date', 'Location', 'PP', 'FP', 'SP', 'IR']);
    expect(screen.getByText(/Partial Presentations/)).toBeTruthy(); // key explaining the abbreviations
    expect(screen.getByText('–')).toBeTruthy(); // the missing follow-up count
  });

  it('says so when there are no results', async () => {
    fetchResults.mockResolvedValue([]);
    render(<MyCampaignResultsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Show my results' }));
    await waitFor(() => expect(screen.getByText('No campaign results found for you yet.')).toBeTruthy());
  });

  it('shows an inline error when loading fails', async () => {
    fetchResults.mockRejectedValue(new Error('Server said no'));
    render(<MyCampaignResultsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Show my results' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Server said no'));
  });
});
