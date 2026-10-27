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
import { getSettingServer, setPublicLinkTitle, setPublicLinkDescription, getTechInsightsConfig, setTechInsightsHotkey } from '../appSettings';

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

describe('Tech Insights settings', () => {
  const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

  it('is off with the default shortcut when nothing is stored', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [], error: null }));
    expect(await getTechInsightsConfig()).toEqual({ enabled: false, hotkey: 'Ctrl+Alt+I' });
  });

  it('reads both settings in one query', async () => {
    const builder = makeQueryBuilder({
      data: [
        { setting_key: 'tech_insights_enabled', setting_value: 'true' },
        { setting_key: 'tech_insights_hotkey', setting_value: 'Alt+Ctrl+J' },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(builder);
    expect(await getTechInsightsConfig()).toEqual({ enabled: true, hotkey: 'Ctrl+Alt+J' });
    expect(builder.in).toHaveBeenCalledWith('setting_key', ['tech_insights_enabled', 'tech_insights_hotkey']);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default shortcut when the stored one is invalid, and stays off on a read error', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [{ setting_key: 'tech_insights_hotkey', setting_value: 'banana' }], error: null }));
    expect((await getTechInsightsConfig()).hotkey).toBe('Ctrl+Alt+I');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'boom' } }));
    expect(await getTechInsightsConfig()).toEqual({ enabled: false, hotkey: 'Ctrl+Alt+I' });
  });

  it('refuses to save an invalid shortcut without calling the server', async () => {
    await expect(setTechInsightsHotkey('Shift+I')).rejects.toThrow(/not a valid shortcut/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
