/**
 * The guide is in a private bucket; only a real state_leaders session may
 * get a link to it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockIsLeader = vi.fn();
const mockView = vi.fn();
vi.mock('@/lib/corsUtils', () => ({ enforceOrigin: () => null }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: (t: string) => mockGetUser(t) } } }));
vi.mock('@/lib/services/registrationCheckService', () => ({ isSessionForStateLeader: (...a: unknown[]) => mockIsLeader(...a) }));
vi.mock('@/lib/services/userGuideService', () => ({ getUserGuideView: (...a: unknown[]) => mockView(...a) }));

import { GET } from '../route';

function req(token?: string) {
  return new NextRequest('http://localhost/api/leader/user-guide', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

describe('GET /api/leader/user-guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockIsLeader.mockResolvedValue(true);
    mockView.mockResolvedValue({ url: 'https://signed/guide.pdf', uploadedAt: '2026-10-15T00:00:00.000Z' });
  });

  it('401 without a token', async () => {
    expect((await GET(req())).status).toBe(401);
    expect(mockView).not.toHaveBeenCalled();
  });

  it('401 for an invalid session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
    expect((await GET(req('bad'))).status).toBe(401);
    expect(mockView).not.toHaveBeenCalled();
  });

  it('403 for a session that is not a state leader', async () => {
    mockIsLeader.mockResolvedValue(false);
    expect((await GET(req('t'))).status).toBe(403);
    expect(mockView).not.toHaveBeenCalled();
  });

  it('returns the signed link for a leader', async () => {
    const res = await GET(req('t'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://signed/guide.pdf', uploadedAt: '2026-10-15T00:00:00.000Z' });
  });

  it('returns { url: null } when no guide has been uploaded', async () => {
    mockView.mockResolvedValue(null);
    expect(await (await GET(req('t'))).json()).toEqual({ url: null });
  });
});
