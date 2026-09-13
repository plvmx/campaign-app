import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PublicCampaignInterestActions from '../PublicCampaignInterestActions';

const CONSENT_TEXT = /your details will be made available to the team leader/i;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function installFetchMock(ok = true, error = 'Something went wrong') {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => (ok ? { success: true } : { error }),
  }) as unknown as typeof fetch;
}

describe('PublicCampaignInterestActions', () => {
  it('does not submit immediately — clicking "Yes I\'m In" opens a confirmation modal first', () => {
    installFetchMock();
    render(<PublicCampaignInterestActions registrantId="r1" campaignId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: "Yes I'm In" }));

    expect(screen.getByText(CONSENT_TEXT)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('"Tell Me More" also opens the same confirmation modal before submitting', () => {
    installFetchMock();
    render(<PublicCampaignInterestActions registrantId="r1" campaignId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Tell Me More' }));

    expect(screen.getByText(CONSENT_TEXT)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('Cancel closes the modal without submitting', () => {
    installFetchMock();
    render(<PublicCampaignInterestActions registrantId="r1" campaignId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: "Yes I'm In" }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(CONSENT_TEXT)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('Proceed submits with the registrant/campaign id and the interest type that was clicked', async () => {
    installFetchMock();
    render(<PublicCampaignInterestActions registrantId="r1" campaignId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: "Yes I'm In" }));
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/public/campaigns-near-me',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ registrantId: 'r1', campaignId: 'c1', interestType: 'in' }),
      }),
    ));
  });

  it('sends interestType "more" when Tell Me More was the button confirmed', async () => {
    installFetchMock();
    render(<PublicCampaignInterestActions registrantId="r1" campaignId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Tell Me More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/public/campaigns-near-me',
      expect.objectContaining({ body: JSON.stringify({ registrantId: 'r1', campaignId: 'c1', interestType: 'more' }) }),
    ));
  });

  it('shows a confirmation message and closes the modal once the submission succeeds', async () => {
    installFetchMock(true);
    render(<PublicCampaignInterestActions registrantId="r1" campaignId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: "Yes I'm In" }));
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));

    expect(await screen.findByText(/you're registered/i)).toBeInTheDocument();
    expect(screen.queryByText(CONSENT_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Yes I'm In" })).not.toBeInTheDocument();
  });

  it('shows an inline error inside the still-open modal when the submission fails, allowing retry', async () => {
    installFetchMock(false, 'Not found');
    render(<PublicCampaignInterestActions registrantId="r1" campaignId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: "Yes I'm In" }));
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));

    expect(await screen.findByText('Not found')).toBeInTheDocument();
    // Modal is still open, with Proceed available again for a retry.
    expect(screen.getByText(CONSENT_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeInTheDocument();
  });
});
