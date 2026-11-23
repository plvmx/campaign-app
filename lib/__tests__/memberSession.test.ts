import { describe, it, expect } from 'vitest';
import { readSessionCookie, sessionCookieOptions, signSessionCookie, MEMBER_SESSION_TTL_MS } from '../memberSession';

const SECRET = 's'.repeat(40);

describe('session cookie', () => {
  it('round-trips a session id', () => {
    expect(readSessionCookie(signSessionCookie('abc_DEF-123', SECRET), SECRET)).toBe('abc_DEF-123');
  });
  it('rejects a forged, tampered, re-keyed or malformed cookie', () => {
    const good = signSessionCookie('abc', SECRET);
    expect(readSessionCookie(`other.${good.split('.')[1]}`, SECRET)).toBeNull();
    expect(readSessionCookie(`${good}x`, SECRET)).toBeNull();
    expect(readSessionCookie(good, 'z'.repeat(40))).toBeNull();
    for (const bad of ['', 'nodot', '.sig', undefined, null]) expect(readSessionCookie(bad, SECRET)).toBeNull();
  });
  it('is HttpOnly, SameSite=Lax, lasting as long as a session; Secure only in production', () => {
    expect(sessionCookieOptions(true)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: MEMBER_SESSION_TTL_MS / 1000 });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});
