import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '../supabaseClient';
import { makeQueryBuilder } from '../services/__tests__/supabaseMock';
import {
  getAllStateRefreshSettings,
  getStateRefreshMode,
  setStateRefreshMode,
  DEFAULT_REFRESH_MODE,
} from '../stateRefreshSettings';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAllStateRefreshSettings', () => {
  it('returns a Map of state -> refresh_mode', async () => {
    mockFrom.mockReturnValue(
      makeQueryBuilder({
        data: [
          { state: 'VIC', refresh_mode: 'rules' },
          { state: 'NSW', refresh_mode: 'copy' },
        ],
        error: null,
      }),
    );
    const result = await getAllStateRefreshSettings();
    expect(result).toEqual(new Map([['VIC', 'rules'], ['NSW', 'copy']]));
  });

  it('returns an empty Map when no rows exist', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    expect(await getAllStateRefreshSettings()).toEqual(new Map());
  });

  it('throws on error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = { message: 'db down' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getAllStateRefreshSettings()).rejects.toEqual(error);
    consoleErrorSpy.mockRestore();
  });
});

describe('getStateRefreshMode', () => {
  it('returns the saved mode for a state', async () => {
    const builder = makeQueryBuilder({ data: { refresh_mode: 'both' }, error: null });
    mockFrom.mockReturnValue(builder);
    const result = await getStateRefreshMode('VIC');
    expect(result).toBe('both');
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
  });

  it('falls back to DEFAULT_REFRESH_MODE when the state has no saved setting', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    expect(await getStateRefreshMode('VIC')).toBe(DEFAULT_REFRESH_MODE);
  });

  it('throws on error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = { message: 'db down' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getStateRefreshMode('VIC')).rejects.toEqual(error);
    consoleErrorSpy.mockRestore();
  });
});

describe('setStateRefreshMode', () => {
  it('upserts by state, stamping updated_at and updated_by', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await setStateRefreshMode('VIC', 'rules', 'user-1');
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'VIC', refresh_mode: 'rules', updated_by: 'user-1' }),
      { onConflict: 'state' },
    );
  });

  it('defaults updated_by to null when omitted', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await setStateRefreshMode('VIC', 'rules');
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ updated_by: null }),
      { onConflict: 'state' },
    );
  });

  it('throws on error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = { message: 'db down' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(setStateRefreshMode('VIC', 'rules')).rejects.toEqual(error);
    consoleErrorSpy.mockRestore();
  });
});
