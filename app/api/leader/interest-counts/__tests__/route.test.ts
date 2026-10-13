import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } } }));
vi.mock('@/lib/corsUtils', () => ({ enforceOrigin: () => null }));
const mockCreateClient = vi.fn(() => ({ marker: 'user-client' }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => mockCreateClient(...(a as [])) }));
const mockCounts = vi.fn();
vi.mock('@/lib/services/interestCountsService', () => ({
  MAX_CAMPAIGN_IDS: 500,
  getVisibleInterestCounts: (...a: unknown[]) => mockCounts(...a),
}));

import { POST } from '../route';

function req(body: unknown, token?: string) {
  return new NextRequest('http://localhost/api/leader/interest-counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockCounts.mockReset().mockResolvedValue({ campaignInterest: { c1: 2 }, trainingInterest: {} });
  mockCreateClient.mockClear();
});

describe('POST /api/leader/interest-counts', () => {
  it('401 without a token, touching nothing', async () => {
    expect((await POST(req({ campaignIds: ['c1'] }))).status).toBe(401);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockCounts).not.toHaveBeenCalled();
  });

  it('401 for an invalid session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
    expect((await POST(req({ campaignIds: ['c1'] }, 'bad'))).status).toBe(401);
    expect(mockCounts).not.toHaveBeenCalled();
  });

  it('400 for a malformed or oversized id list', async () => {
    expect((await POST(req({ campaignIds: 'c1' }, 't'))).status).toBe(400);
    expect((await POST(req({ campaignIds: [1] }, 't'))).status).toBe(400);
    expect((await POST(req({ campaignIds: Array(501).fill('x') }, 't'))).status).toBe(400);
    expect(mockCounts).not.toHaveBeenCalled();
  });

  it('returns counts, computed with a client that carries the CALLER\'s own token (so RLS decides what they can see)', async () => {
    const res = await POST(req({ campaignIds: ['c1'] }, 'tok-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaignInterest: { c1: 2 }, trainingInterest: {} });
    const options = (mockCreateClient.mock.calls[0] as unknown[])[2] as { global: { headers: { Authorization: string } } };
    expect(options.global.headers.Authorization).toBe('Bearer tok-1');
    expect(mockCounts).toHaveBeenCalledWith({ marker: 'user-client' }, expect.anything(), ['c1']);
  });

  it('500 (no details leaked) if the lookup throws', async () => {
    mockCounts.mockRejectedValue(new Error('db down'));
    const res = await POST(req({ campaignIds: ['c1'] }, 't'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('db down');
  });
});
