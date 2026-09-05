import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import {
  getCampaignReportsNeedingReview,
  updateCampaignReportDerivedFields,
  type CampaignReportForReview,
} from '../campaignReportsService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = vi.mocked(supabase.auth.getSession);

function makeRow(overrides: Partial<CampaignReportForReview> = {}): CampaignReportForReview {
  return {
    id: 'r1',
    submitted_at: '2026-05-10T00:00:00.000Z',
    campaign_date: '2026-05-10',
    campaign_date_raw: null,
    location_raw: 'Dandenong',
    leader_raw: 'Brent',
    derived_state: null,
    derived_place: null,
    derived_leader: null,
    ...overrides,
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('getCampaignReportsNeedingReview', () => {
  it('queries rows since the given date missing at least one derived field, ordered oldest first', async () => {
    const rows = [makeRow()];
    const builder = makeQueryBuilder({ data: rows, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await getCampaignReportsNeedingReview('2026-05-06');

    expect(mockFrom).toHaveBeenCalledWith('campaign_reports');
    expect(builder.gte).toHaveBeenCalledWith('submitted_at', '2026-05-06');
    expect(builder.or).toHaveBeenCalledWith('derived_state.is.null,derived_place.is.null,derived_leader.is.null');
    expect(builder.order).toHaveBeenCalledWith('submitted_at', { ascending: true });
    expect(result).toEqual(rows);
  });

  it('returns an empty array when there is nothing to review', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [], error: null }));
    expect(await getCampaignReportsNeedingReview('2026-05-06')).toEqual([]);
  });

  it('throws when the query errors', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'boom' } }));
    await expect(getCampaignReportsNeedingReview('2026-05-06')).rejects.toEqual({ message: 'boom' });
  });
});

describe('updateCampaignReportDerivedFields', () => {
  it('throws without calling the API when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);

    await expect(
      updateCampaignReportDerivedFields('r1', { derived_state: 'VIC', derived_place: 'Dandenong', derived_leader: 'Brent' }),
    ).rejects.toThrow('Not authenticated');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the id and fields to the derived-fields API with a bearer token', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);

    await updateCampaignReportDerivedFields('r1', { derived_state: 'VIC', derived_place: 'Dandenong', derived_leader: 'Brent' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/campaign-reports/derived-fields',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
        body: JSON.stringify({ id: 'r1', derived_state: 'VIC', derived_place: 'Dandenong', derived_leader: 'Brent' }),
      }),
    );
  });

  it('throws the API-provided error message when the request fails', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    } as Response);

    await expect(
      updateCampaignReportDerivedFields('r1', { derived_state: null, derived_place: null, derived_leader: null }),
    ).rejects.toThrow('Forbidden');
  });

  it('falls back to a generic error message when the API response has no body', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok123' } },
      error: null,
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('no body'); },
    } as unknown as Response);

    await expect(
      updateCampaignReportDerivedFields('r1', { derived_state: null, derived_place: null, derived_leader: null }),
    ).rejects.toThrow('Failed to save (500)');
  });
});
