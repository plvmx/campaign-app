import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
const getConfig = vi.fn();
const setConfig = vi.fn();
vi.mock('@/lib/appSettings', () => ({
  getDonationNoticeEmailConfig: (...a: unknown[]) => getConfig(...a),
  setDonationNoticeEmailConfig: (...a: unknown[]) => setConfig(...a),
}));

import DonationNoticeEmailCard from '../DonationNoticeEmailCard';

beforeEach(() => {
  getConfig.mockResolvedValue({ enabled: false, recipients: ['a@example.com'] });
  setConfig.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

const boxes = () => [1, 2, 3, 4].map((n) => screen.getByLabelText(`Email address ${n}`) as HTMLInputElement);

describe('DonationNoticeEmailCard', () => {
  it('loads the saved switch and recipients into four boxes', async () => {
    render(<DonationNoticeEmailCard />);
    await waitFor(() => expect(boxes()[0].value).toBe('a@example.com'));
    expect(boxes()).toHaveLength(4);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('blocks Save with inline errors for a bad or repeated address', async () => {
    render(<DonationNoticeEmailCard />);
    await waitFor(() => expect(boxes()[0].value).toBe('a@example.com'));
    fireEvent.change(boxes()[1], { target: { value: 'nope' } });
    fireEvent.change(boxes()[2], { target: { value: 'A@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Enter a valid email address.', 'This address is already listed.']);
    expect(setConfig).not.toHaveBeenCalled();
  });

  it('will not switch sending on with nobody listed', async () => {
    getConfig.mockResolvedValue({ enabled: false, recipients: [] });
    render(<DonationNoticeEmailCard />);
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one email address');
    expect(setConfig).not.toHaveBeenCalled();
  });

  it('saves the switch and trimmed recipients', async () => {
    render(<DonationNoticeEmailCard />);
    await waitFor(() => expect(boxes()[0].value).toBe('a@example.com'));
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(boxes()[1], { target: { value: '  b@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setConfig).toHaveBeenCalledWith({ enabled: true, recipients: ['a@example.com', 'b@example.com'] }));
    expect(await screen.findByText('Saved. Donation notice emails are on.')).toBeInTheDocument();
  });
});
