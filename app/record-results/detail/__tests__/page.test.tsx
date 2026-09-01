/**
 * Regression test: the per-section counts shown on Record Results
 * ("Partial Presentations: 2", etc.) are a live tally of names typed into
 * that section's grid, but were never persisted to the campaign record.
 * The `pp_cnt`/`fp_cnt`/`fpsp_cnt`/`ir_cnt`/`team_size` columns on
 * `campaigns` still exist and still autosave, but the manual numeric
 * inputs that used to feed them were removed (see #e93bd3c, #88407aa)
 * without ever wiring the replacement name-grid counts back in — so those
 * columns stayed frozen at whatever they were before (usually null),
 * even as leaders typed names into the grid every week.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Campaign } from '@/lib/types';

// The page imports lib/campaignLog.ts -> lib/supabaseClient.ts, which
// requires real env vars at import time.
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
const mockSearchParams = { get: (key: string) => (key === 'id' ? 'c1' : null) };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/components/MobileLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseUser = vi.fn();
vi.mock('@/contexts/UserContext', () => ({
  useUser: () => mockUseUser(),
}));

const baseCampaign: Campaign = {
  id: 'c1',
  date: '2026-08-01',
  state: 'VIC',
  place: 'Testville',
  site: '',
  time: '10:00:00',
  leader: 'Jane Smith',
  mobile: null,
  category: 'TWOL',
  tl_ok: false,
  sr_ok: false,
  created_at: '2026-07-01T00:00:00.000Z',
  team_size: null,
  pp_cnt: null,
  fp_cnt: null,
  fpsp_cnt: null,
  ir_cnt: null,
  actual_leader: null,
};

const getCampaignById = vi.fn();
const updateCampaign = vi.fn();
vi.mock('@/lib/services/campaignService', () => ({
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  updateCampaign: (...args: unknown[]) => updateCampaign(...args),
  createCampaign: vi.fn(),
  findCampaignsByKey: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/services/resultsService', () => ({
  getResultsByCampaignId: vi.fn().mockResolvedValue([]),
  insertResults: vi.fn().mockImplementation((rows: Array<{ first_name: string; category_code: string }>) =>
    Promise.resolve(rows.map((r, i) => ({ id: `new-${i}`, first_name: r.first_name, category_code: r.category_code }))),
  ),
  updateResult: vi.fn().mockResolvedValue(undefined),
  deleteResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/campaignLog', () => ({
  fetchCampaignData: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/leaderShares', () => ({
  getSharedWithMeOwners: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/resultsLog', () => ({
  logResultsSave: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
}));

import RecordResultsDetailPage from '../page';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUser.mockReturnValue({
    user: { id: 'u1' },
    isAdmin: true,
    adminStatus: 'AD',
    userState: 'VIC',
    userLeader: 'Jane Smith',
    userMobile: null,
    isLoading: false,
  });
  getCampaignById.mockResolvedValue(baseCampaign);
  updateCampaign.mockResolvedValue(baseCampaign);
});

describe('Record Results — counts persisted to the campaign record', () => {
  it('saves pp_cnt to the campaign as names are typed into Partial Presentations', async () => {
    const { unmount } = render(<RecordResultsDetailPage />);

    await waitFor(() => expect(screen.getByText('Partial Presentations')).toBeInTheDocument());

    // Grid order is Team Members (3 slots), then Partial Presentations —
    // the first Partial slot is the 4th "Enter first name" input overall.
    const nameInputs = screen.getAllByPlaceholderText('Enter first name');
    fireEvent.change(nameInputs[3], { target: { value: 'Alice' } });

    // The on-screen tally updates immediately, purely client-side.
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());

    // Unmounting flushes every pending autosave synchronously (pagehide/
    // unmount guard), without waiting on the 2s name debounce.
    unmount();

    await waitFor(() => {
      expect(updateCampaign).toHaveBeenCalledWith(
        'c1',
        { pp_cnt: 1, fp_cnt: 0, fpsp_cnt: 0, ir_cnt: 0 },
        null,
      );
    });
  });
});
