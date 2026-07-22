import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/userProfile', () => ({
  getUserProfile: vi.fn(),
}));
vi.mock('@/lib/appSettings', () => ({
  isCampaignLoggingEnabled: vi.fn(),
}));

import { supabase } from '@/lib/supabaseClient';
import { getCurrentUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/userProfile';
import { isCampaignLoggingEnabled } from '@/lib/appSettings';
import { logCampaignChange } from '../campaignLog';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetUserProfile = vi.mocked(getUserProfile);
const mockIsCampaignLoggingEnabled = vi.mocked(isCampaignLoggingEnabled);

/** Chainable insert-only fake — logCampaignChange only ever calls .from(table).insert([...]). */
function makeInsertBuilder() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return { insert };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCampaignLoggingEnabled.mockResolvedValue(true);
  mockGetCurrentUser.mockResolvedValue({ id: 'user-1', email: 'leader@example.com' });
  mockGetUserProfile.mockResolvedValue({
    id: 'profile-1', user_id: 'user-1', name: 'Alice', state: null,
    regular_place: null, regular_time: null, created_at: '', updated_at: '',
  });
  // Simulate an admin-panel page — the route this change originates from must not affect
  // whether it gets logged (regression: admin routes used to be silently excluded, which
  // made a real missing-campaigns incident much harder to investigate — see PR #92/#93).
  Object.defineProperty(window, 'location', {
    value: { pathname: '/admin/campaign-rules' },
    writable: true,
  });
});

describe('logCampaignChange', () => {
  it('logs an INSERT made from an admin route', async () => {
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    await logCampaignChange('campaign-1', 'INSERT', null, { state: 'VIC', place: 'Melbourne' });

    expect(mockFrom).toHaveBeenCalledWith('campaign_changes_log');
    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        campaign_id: 'campaign-1',
        change_type: 'INSERT',
        user_id: 'user-1',
        user_name: 'Alice',
        new_data: { state: 'VIC', place: 'Melbourne' },
      }),
    ]);
  });

  it('logs a DELETE made from an admin route', async () => {
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    await logCampaignChange('campaign-1', 'DELETE', { state: 'VIC', place: 'Melbourne' }, null);

    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ change_type: 'DELETE', old_data: { state: 'VIC', place: 'Melbourne' } }),
    ]);
  });

  it('logs an UPDATE with only the fields that actually changed', async () => {
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    await logCampaignChange(
      'campaign-1', 'UPDATE',
      { place: 'Melbourne', time: '10:00' },
      { place: 'Melbourne', time: '11:00' },
    );

    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ change_type: 'UPDATE', changed_fields: ['time'] }),
    ]);
  });

  it('skips an UPDATE where nothing actually changed', async () => {
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    await logCampaignChange('campaign-1', 'UPDATE', { place: 'Melbourne' }, { place: 'Melbourne' });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('skips logging when campaign logging is disabled', async () => {
    mockIsCampaignLoggingEnabled.mockResolvedValue(false);
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    await logCampaignChange('campaign-1', 'INSERT', null, { state: 'VIC' });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('skips logging when there is no authenticated user', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    await logCampaignChange('campaign-1', 'INSERT', null, { state: 'VIC' });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not throw when the insert itself fails', async () => {
    const builder = { insert: vi.fn().mockResolvedValue({ error: { message: 'db down' } }) };
    mockFrom.mockReturnValue(builder);

    await expect(
      logCampaignChange('campaign-1', 'INSERT', null, { state: 'VIC' }),
    ).resolves.toBeUndefined();
  });
});
