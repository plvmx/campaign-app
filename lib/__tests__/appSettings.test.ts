import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeQueryBuilder } from '../services/__tests__/supabaseMock';

vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
}));
vi.mock('../supabaseAdmin', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabase } from '../supabaseClient';
import { supabaseAdmin } from '../supabaseAdmin';
import { getSettingServer, setPublicLinkTitle, setPublicLinkDescription } from '../appSettings';

const mockAdminFrom = vi.mocked(supabaseAdmin.from) as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = vi.mocked(supabase.auth.getSession);

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('getSettingServer', () => {
  it('returns the stored value via the service-role client', async () => {
    mockAdminFrom.mockReturnValue(makeQueryBuilder({ data: { setting_value: 'Custom Title' }, error: null }));
    const value = await getSettingServer('some_unique_key_1');
    expect(value).toBe('Custom Title');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('app_settings');
  });

  it('returns null when no row exists (PGRST116)', async () => {
    mockAdminFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: 'PGRST116' } }));
    const value = await getSettingServer('some_unique_key_2');
    expect(value).toBeNull();
  });

  it('returns null (without throwing) on an unexpected query error', async () => {
    mockAdminFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: 'XXOOO', message: 'boom' } }));
    const value = await getSettingServer('some_unique_key_3');
    expect(value).toBeNull();
  });

  it('caches the result so a repeat call within the TTL skips the query', async () => {
    mockAdminFrom.mockReturnValue(makeQueryBuilder({ data: { setting_value: 'A' }, error: null }));
    await getSettingServer('some_unique_key_4');
    await getSettingServer('some_unique_key_4');
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });
});

describe('setPublicLinkTitle / setPublicLinkDescription', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
  });

  it('setPublicLinkTitle POSTs the namespaced key and value to the admin settings route', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await setPublicLinkTitle('week1-campaigns', 'New Title');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/settings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toMatchObject({ key: 'public_link_title__week1-campaigns', value: 'New Title' });
  });

  it('setPublicLinkDescription POSTs the namespaced key and value to the admin settings route', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await setPublicLinkDescription('week1-campaigns', 'New description');

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toMatchObject({ key: 'public_link_description__week1-campaigns', value: 'New description' });
  });

  it('throws when there is no authenticated session', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);

    await expect(setPublicLinkTitle('week1-campaigns', 'x')).rejects.toThrow('Not authenticated');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws the server-provided error message when the request fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    await expect(setPublicLinkTitle('week1-campaigns', 'x')).rejects.toThrow('Forbidden');
  });
});
