/**
 * Regression test: PR #174 shipped /admin/campaign-reports-cleanup but never
 * added a card for it on this hub page, so it was only reachable by typing
 * the URL directly (no admin ever saw it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// The page imports lib/supabaseClient.ts, which requires real env vars at
// import time — and app/admin/page.tsx queries it directly for the last
// weekly-refresh row.
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@/components/MobileLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseUser = vi.fn();
vi.mock('@/contexts/UserContext', () => ({
  useUser: () => mockUseUser(),
}));

vi.mock('@/contexts/CampaignDatesContext', () => ({
  useCampaignDates: () => ({ dates: null }),
}));

vi.mock('@/lib/appSettings', () => ({
  isCampaignLoggingEnabled: vi.fn().mockResolvedValue(true),
  setCampaignLoggingEnabled: vi.fn(),
  getSlideViewEnabled: vi.fn().mockResolvedValue(false),
  setSlideViewEnabled: vi.fn(),
}));

vi.mock('@/lib/services/weeklyRefreshService', () => ({
  runWeeklyRefresh: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
}));

import AdminPage from '../page';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUser.mockReturnValue({
    user: { id: 'u1' },
    isAdmin: true,
    isLoading: false,
  });
});

describe('Admin hub — Campaign Report Cleanup link', () => {
  it('links to /admin/campaign-reports-cleanup', async () => {
    render(<AdminPage />);

    await waitFor(() => expect(screen.getByText('Campaign Report Cleanup')).toBeInTheDocument());

    const button = screen.getByRole('button', { name: /Review Records/i });
    button.click();
    expect(mockPush).toHaveBeenCalledWith('/admin/campaign-reports-cleanup');
  });
});
