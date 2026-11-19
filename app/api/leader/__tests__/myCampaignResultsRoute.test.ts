import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { name: 'admin-client' } }));
const authorize = vi.fn();
vi.mock('@/lib/leaderRouteGuard', () => ({ authorizeLeaderRequest: (...a: unknown[]) => authorize(...a) }));
const getResults = vi.fn();
vi.mock('@/lib/services/myCampaignResultsService', () => ({ getMyCampaignResults: (...a: unknown[]) => getResults(...a) }));

import { GET } from '../my-campaign-results/route';

const call = () => GET(new NextRequest('http://localhost/api/leader/my-campaign-results?leader=Someone%20Else&state=NSW'));

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({ ok: true, userId: 'u1', caller: { adminStatus: null, state: 'VIC', leader: 'Maria', mobile: '0400' }, sharedWithMeOwners: [] });
});

describe('GET /api/leader/my-campaign-results', () => {
  it('returns the guard response when not authorised', async () => {
    authorize.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await call()).status).toBe(401);
    expect(getResults).not.toHaveBeenCalled();
  });

  it("only ever uses the caller's own state and leader, never the query string", async () => {
    getResults.mockResolvedValue([{ id: 'r1' }]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ id: 'r1' }] });
    expect(getResults).toHaveBeenCalledWith({ name: 'admin-client' }, { state: 'VIC', leader: 'Maria' });
  });

  it('answers 502 when the lookup fails', async () => {
    getResults.mockRejectedValue(new Error('boom'));
    expect((await call()).status).toBe(502);
  });
});
