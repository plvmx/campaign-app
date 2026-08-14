/**
 * Regression test: the Add/Edit Campaign Rule form rendered its "Mobile"
 * input unconditionally, with no role check — unlike the sibling Add
 * Campaign dialogs (CampaignCreateForm / CampaignForm), which already
 * hide this field from regular team leaders (see #124). A regular
 * (non-admin, non-state-reporter) team leader could see and edit the raw
 * mobile number auto-filled from state_leaders. Only full admins ('AD')
 * and state reporters ('SR') should see it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// The page imports lib/campaignFilter.ts -> lib/supabaseClient.ts, which
// requires real env vars at import time.
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

// Stable object references — the page's effects depend on `router` and
// `searchParams` by reference, so a mock that returns a fresh object literal
// on every call would make those effects re-fire on every render and spin
// into an infinite loop.
const mockPush = vi.fn();
const mockRouter = { push: mockPush };
const mockSearchParams = { get: () => null };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

// MobileLayout pulls in auth/session chrome unrelated to this test — render
// its children directly.
vi.mock('@/components/MobileLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/services/rulesService', () => ({
  getRules: vi.fn().mockResolvedValue([]),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  setRuleActive: vi.fn(),
}));

vi.mock('@/lib/services/dropdownService', () => ({
  getPlacesForState: vi.fn().mockResolvedValue([]),
  getLeadersForState: vi.fn().mockResolvedValue([]),
  getLeaderMobile: vi.fn().mockResolvedValue('0400 999 999'),
}));

const mockUseUser = vi.fn();
vi.mock('@/contexts/UserContext', () => ({
  useUser: () => mockUseUser(),
}));

import CampaignRulesPage from '../page';

afterEach(cleanup);

function mockUser(adminStatus: string | null) {
  mockUseUser.mockReturnValue({
    user: { id: 'u1' },
    adminStatus,
    userState: 'VIC',
    userLeader: 'Jane Smith',
    isLoading: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

const MOBILE_LABEL = /Mobile \(Optional - auto-filled from state_leaders\)/i;

describe('Campaign Rules page — mobile field visibility', () => {
  it('hides the Mobile field from a regular (non-admin, non-SR) team leader', async () => {
    mockUser(null);
    render(<CampaignRulesPage />);
    await waitFor(() => expect(screen.getByText('Add New Campaign Rule')).toBeInTheDocument());
    expect(screen.queryByLabelText(MOBILE_LABEL)).not.toBeInTheDocument();
  });

  it('shows the Mobile field to a full admin', async () => {
    mockUser('AD');
    render(<CampaignRulesPage />);
    await waitFor(() => expect(screen.getByLabelText(MOBILE_LABEL)).toBeInTheDocument());
  });

  it('shows the Mobile field to a state reporter', async () => {
    mockUser('SR');
    render(<CampaignRulesPage />);
    await waitFor(() => expect(screen.getByLabelText(MOBILE_LABEL)).toBeInTheDocument());
  });
});
