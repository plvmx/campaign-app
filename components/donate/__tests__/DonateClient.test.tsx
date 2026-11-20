import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DonateClient from '../DonateClient';

const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe('DonateClient', () => {
  it('links the card donation button straight to Donorbox', () => {
    render(<DonateClient />);
    const link = screen.getByRole('link', { name: 'Donate Now by Card' });
    expect(link).toHaveAttribute('href', 'https://donorbox.org/empower-equip-mobilise');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('blocks the optional notice form with an inline error when the name is left blank', () => {
    render(<DonateClient />);
    fireEvent.click(screen.getByRole('button', { name: "Let us know I'm transferring" }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your name.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('clears the error once the name is filled in and submits successfully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    render(<DonateClient />);
    fireEvent.click(screen.getByRole('button', { name: "Let us know I'm transferring" }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Mary' } });
    fireEvent.click(screen.getByRole('button', { name: "Let us know I'm transferring" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/public/donate', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText(/Thanks, Mary/)).toBeInTheDocument();
  });

  it('shows a submit error without losing the entered details', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({ error: 'Could not send' }) });
    render(<DonateClient />);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Mary' } });
    fireEvent.click(screen.getByRole('button', { name: "Let us know I'm transferring" }));
    expect(await screen.findByText('Could not send')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveValue('Mary');
  });
});
