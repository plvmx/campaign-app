import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/components/PublicRegisterInterestModal', () => ({ default: () => null }));

import PublicMapRegisterInterestActions from '../PublicMapRegisterInterestActions';

describe('PublicMapRegisterInterestActions', () => {
  it('offers both buttons for a campaign that has not happened yet', () => {
    render(<PublicMapRegisterInterestActions campaignId="c1" />);
    expect(screen.getByRole('button', { name: "Yes I'm In" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tell Me More' })).toBeTruthy();
  });

  it('removes the buttons and says so for a past campaign', () => {
    render(<PublicMapRegisterInterestActions campaignId="c1" isPast />);
    expect(screen.queryByRole('button', { name: "Yes I'm In" })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tell Me More' })).toBeNull();
    expect(screen.getByTestId('campaign-past-note')).toBeTruthy();
  });
});
