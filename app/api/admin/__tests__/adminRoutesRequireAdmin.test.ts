/**
 * Every admin-only API route must refuse a caller who isn't a full admin
 * signed in with 2FA — via the shared verifyAdminCaller — *before* touching
 * anything else. These routes use the service role, which bypasses RLS, so
 * this check is the only thing protecting what they write. They used to each
 * copy-paste their own version (with an ILIKE that treated `_` in names as a
 * wildcard and no 2FA requirement); this pins that they all go through the
 * one shared check and stop when it says no.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockVerify = vi.fn();
vi.mock('@/lib/services/adminCallerService', () => ({
  verifyAdminCaller: (...args: unknown[]) => mockVerify(...args),
}));
vi.mock('@/lib/corsUtils', () => ({ enforceOrigin: () => null }));
// Any use of the service-role client past the admin check is a failure.
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: new Proxy({}, { get() { throw new Error('supabaseAdmin was used for a denied caller'); } }),
}));
vi.mock('@/lib/geocoding', () => ({ geocodeAddress: vi.fn(), geocodePlace: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

type Handler = (r: NextRequest) => Promise<Response>;
type Method = 'POST' | 'GET' | 'PATCH';
const ROUTES: Array<[string, () => Promise<{ POST?: Handler; GET?: Handler; PATCH?: Handler }>, Method]> = [
  ['settings', () => import('../settings/route'), 'POST'],
  ['geocode-address', () => import('../geocode-address/route'), 'POST'],
  ['geocode-place', () => import('../geocode-place/route'), 'POST'],
  ['invalidate-user-session', () => import('../invalidate-user-session/route'), 'POST'],
  ['campaign-reports/locations', () => import('../campaign-reports/locations/route'), 'GET'],
  ['campaign-reports/locations', () => import('../campaign-reports/locations/route'), 'POST'],
  ['campaign-reports/manage', () => import('../campaign-reports/manage/route'), 'GET'],
  ['campaign-reports/manage', () => import('../campaign-reports/manage/route'), 'PATCH'],
  ['campaign-reports/edit-log', () => import('../campaign-reports/edit-log/route'), 'GET'],
  ['stuck-leaders', () => import('../stuck-leaders/route'), 'GET'],
  ['reset-mfa', () => import('../reset-mfa/route'), 'POST'],
  ['check-registration', () => import('../check-registration/route'), 'POST'],
  ['user-guide/upload-url', () => import('../user-guide/upload-url/route'), 'POST'],
  ['tech-insights', () => import('../tech-insights/route'), 'GET'],
];

function makeRequest(name: string, token?: string, method: Method = 'POST') {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (method === 'GET') return new NextRequest(`http://localhost/api/admin/${name}`, { method, headers });
  return new NextRequest(`http://localhost/api/admin/${name}`, {
    method,
    headers,
    body: JSON.stringify({ key: 'campaign_logging_enabled', value: 'true', address: 'x', state: 'VIC', place: 'x', leader: 'x', id: 'x', leaderId: 'x', email: 'a@example.com' }),
  });
}

describe.each(ROUTES)('/api/admin/%s', (name, load, method) => {
  beforeEach(() => {
    mockVerify.mockReset();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 401 without a Bearer token, without checking anything', async () => {
    const handler = (await load())[method] as Handler;
    const res = await handler(makeRequest(name, undefined, method));
    expect(res.status).toBe(401);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('refuses a caller verifyAdminCaller rejects (403) and does nothing else', async () => {
    mockVerify.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const handler = (await load())[method] as Handler;
    const res = await handler(makeRequest(name, 'tok-123', method));

    expect(res.status).toBe(403);
    expect(mockVerify).toHaveBeenCalledWith(expect.anything(), 'tok-123');
  });

  it('passes through a 401 for an invalid session', async () => {
    mockVerify.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });
    const handler = (await load())[method] as Handler;
    expect((await handler(makeRequest(name, 'bad', method))).status).toBe(401);
  });

  it('refuses an admin whose session is not at 2FA level', async () => {
    mockVerify.mockResolvedValue({ ok: false, status: 403, error: 'Two-factor sign-in is required for this action' });
    const handler = (await load())[method] as Handler;
    const res = await handler(makeRequest(name, 'tok-aal1', method));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Two-factor sign-in is required for this action' });
  });
});
