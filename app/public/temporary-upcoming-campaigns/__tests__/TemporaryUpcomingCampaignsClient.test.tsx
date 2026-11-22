import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/PublicCampaignList', () => ({ default: () => <div /> }));
vi.mock('@/lib/slideGenerator', () => ({ generateAndDownloadSlidesFromData: vi.fn() }));

import TemporaryUpcomingCampaignsClient from '../TemporaryUpcomingCampaignsClient';

describe('TemporaryUpcomingCampaignsClient instructions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  });

  it('hides the instructions until the link is clicked, and toggles them', () => {
    render(<TemporaryUpcomingCampaignsClient />);
    expect(screen.queryByText(/that your campaign details are correct/)).toBeNull();
    expect(screen.queryByText('ALL LEADERS please:')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'CLICK HERE FOR INSTRUCTIONS' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(screen.getByText(/that your campaign details are correct/)).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);
    expect(screen.queryByText(/that your campaign details are correct/)).toBeNull();
  });
});
