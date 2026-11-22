import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { name: 'admin-client' } }));

const SECRET = 'm'.repeat(40);
vi.mock('@/lib/memberAuthDeps', () => ({ buildMemberAuthDeps: async () => ({ secret: SECRET }) }));

const requestCodes = vi.fn();
const verifyCodes = vi.fn();
const lookupInvite = vi.fn();
const getMemberSession = vi.fn();
const revokeMemberSession = vi.fn();
const revokeAllMemberSessions = vi.fn();
vi.mock('@/lib/services/memberAuthService', () => ({
  requestCodes: (...a: unknown[]) => requestCodes(...a),
  verifyCodes: (...a: unknown[]) => verifyCodes(...a),
  lookupInvite: (...a: unknown[]) => lookupInvite(...a),
  getMemberSession: (...a: unknown[]) => getMemberSession(...a),
  revokeMemberSession: (...a: unknown[]) => revokeMemberSession(...a),
  revokeAllMemberSessions: (...a: unknown[]) => revokeAllMemberSessions(...a),
}));

import { GET as inviteGET } from '../invite/route';
import { POST as requestCodesPOST } from '../request-codes/route';
import { POST as verifyPOST } from '../verify/route';
import { POST as signOutPOST } from '../sign-out/route';
import { GET as meGET } from '../me/route';
import { MEMBER_SESSION_COOKIE, signSessionCookie } from '@/lib/memberSession';

const TOKEN = 'a'.repeat(43);
const VID = '11111111-1111-4111-8111-111111111111';
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });

let ipCounter = 0;
const freshIp = () => ({ 'x-forwarded-for': `10.0.0.${++ipCounter}` });

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.MEMBER_AUTH_SECRET = SECRET;
  for (const m of [requestCodes, verifyCodes, lookupInvite, getMemberSession, revokeMemberSession, revokeAllMemberSessions]) m.mockReset();
});

describe('GET /api/member/invite', () => {
  const get = (qs: string) => inviteGET(new NextRequest(`http://localhost/api/member/invite${qs}`, { headers: freshIp() }));

  it('returns masked details and never the raw ones', async () => {
    lookupInvite.mockResolvedValue({ inviteId: 1, registrantId: 'r1', maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678', eligible: true });
    const res = await get(`?i=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678', eligible: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('answers a missing, malformed or unknown token the same way (404)', async () => {
    lookupInvite.mockResolvedValue(null);
    for (const qs of ['', '?i=short', `?i=${TOKEN}`]) expect((await get(qs)).status).toBe(404);
  });
  it('rejects a cross-origin caller', async () => {
    const res = await inviteGET(new NextRequest(`http://localhost/api/member/invite?i=${TOKEN}`, { headers: { origin: 'https://evil.example', host: 'localhost', ...freshIp() } }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/member/request-codes', () => {
  const typed = { email: 'jane@gmail.com', mobile: '0412 345 678' };

  it('returns the verification id and masked details after a send', async () => {
    requestCodes.mockResolvedValue({ status: 'sent', verificationId: VID, maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678' });
    const res = await requestCodesPOST(json('/api/member/request-codes', typed, freshIp()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, verificationId: VID, maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678' });
  });

  it('answers typed details that matched nobody EXACTLY like a send (decoy id, masked typed values)', async () => {
    requestCodes.mockResolvedValue({ status: 'no_match' });
    const res = await requestCodesPOST(json('/api/member/request-codes', typed, freshIp()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['maskedEmail', 'maskedMobile', 'success', 'verificationId']);
    expect(body.success).toBe(true);
    expect(body.verificationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.maskedEmail).toBe('j•••@gmail.com');
  });

  it('tells an invite-link visitor plainly when the link cannot be used', async () => {
    requestCodes.mockResolvedValue({ status: 'no_match' });
    const res = await requestCodesPOST(json('/api/member/request-codes', { invite: TOKEN }, freshIp()));
    expect(res.status).toBe(400);
  });

  it('maps throttling to 429 and a provider failure to 502, with kind wording', async () => {
    requestCodes.mockResolvedValue({ status: 'throttled', reason: 'cooldown' });
    const wait = await requestCodesPOST(json('/api/member/request-codes', typed, freshIp()));
    expect(wait.status).toBe(429);
    expect((await wait.json()).error).toMatch(/wait a minute/);
    requestCodes.mockResolvedValue({ status: 'send_failed' });
    expect((await requestCodesPOST(json('/api/member/request-codes', typed, freshIp()))).status).toBe(502);
  });

  it('validates input before doing anything', async () => {
    const res = await requestCodesPOST(json('/api/member/request-codes', { email: 'nope', mobile: '0412345678' }, freshIp()));
    expect(res.status).toBe(400);
    expect(requestCodes).not.toHaveBeenCalled();
  });

  it('passes the caller IP to the service', async () => {
    requestCodes.mockResolvedValue({ status: 'no_match' });
    await requestCodesPOST(json('/api/member/request-codes', typed, { 'x-forwarded-for': '203.0.113.7' }));
    expect(requestCodes.mock.calls[0][3]).toBe('203.0.113.7');
  });
});

describe('POST /api/member/verify', () => {
  const body = { verificationId: VID, emailCode: '123456', smsCode: '654321' };

  it('on success sets an HttpOnly signed cookie and never puts the session id in the body', async () => {
    verifyCodes.mockResolvedValue({ ok: true, sessionId: 'raw-session-id', registrantId: 'r1' });
    const res = await verifyPOST(json('/api/member/verify', body, freshIp()));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('raw-session-id');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(`${MEMBER_SESSION_COOKIE}=${encodeURIComponent(signSessionCookie('raw-session-id', SECRET))}`);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
  });

  it.each([
    ['invalid', 400, 'invalid'], ['expired', 400, 'expired'], ['locked', 400, 'locked'], ['too_many', 429, undefined],
  ])('maps %s to %i with no cookie', async (reason, status, code) => {
    verifyCodes.mockResolvedValue({ ok: false, reason });
    const res = await verifyPOST(json('/api/member/verify', body, freshIp()));
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects malformed codes without calling the service', async () => {
    const res = await verifyPOST(json('/api/member/verify', { ...body, emailCode: '12' }, freshIp()));
    expect(res.status).toBe(400);
    expect(verifyCodes).not.toHaveBeenCalled();
  });
});

describe('session-gated routes', () => {
  const signedIn = () => new NextRequest('http://localhost/api/member/me', { headers: { cookie: `${MEMBER_SESSION_COOKIE}=${encodeURIComponent(signSessionCookie('sid', SECRET))}` } });

  it('GET /me returns only the first name for a live session', async () => {
    getMemberSession.mockResolvedValue({ registrantId: 'r1', firstName: 'Jane' });
    const res = await meGET(signedIn());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ firstName: 'Jane' });
    expect(getMemberSession.mock.calls[0][2]).toBe('sid');
  });

  it('is 401 with no cookie, a forged cookie, or a session the database does not know', async () => {
    expect((await meGET(new NextRequest('http://localhost/api/member/me'))).status).toBe(401);
    const forged = new NextRequest('http://localhost/api/member/me', { headers: { cookie: `${MEMBER_SESSION_COOKIE}=sid.forged` } });
    expect((await meGET(forged)).status).toBe(401);
    expect(getMemberSession).not.toHaveBeenCalled();
    getMemberSession.mockResolvedValue(null);
    expect((await meGET(signedIn())).status).toBe(401);
  });

  it('is a 500, never a weaker check, when the secret is not configured', async () => {
    delete process.env.MEMBER_AUTH_SECRET;
    expect((await meGET(signedIn())).status).toBe(500);
  });

  it('sign-out revokes this device (or all) and clears the cookie', async () => {
    getMemberSession.mockResolvedValue({ registrantId: 'r1', firstName: 'Jane' });
    const one = await signOutPOST(new NextRequest('http://localhost/api/member/sign-out', { method: 'POST', headers: { cookie: signedIn().headers.get('cookie')! } }));
    expect(one.status).toBe(200);
    expect(revokeMemberSession).toHaveBeenCalledTimes(1);
    expect(one.headers.get('set-cookie')).toContain(`${MEMBER_SESSION_COOKIE}=;`);

    const all = await signOutPOST(new NextRequest('http://localhost/api/member/sign-out', {
      method: 'POST', body: JSON.stringify({ allDevices: true }), headers: { cookie: signedIn().headers.get('cookie')!, 'Content-Type': 'application/json' },
    }));
    expect(all.status).toBe(200);
    expect(revokeAllMemberSessions.mock.calls[0][2]).toBe('r1');
  });
});
