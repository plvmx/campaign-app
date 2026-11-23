/**
 * The member portal's session cookie (docs/member-portal/SIGN_IN_DESIGN.md §7).
 * The cookie value is `<sessionId>.<signature>`: a random session id plus an
 * HMAC of it, so a forged or mangled cookie is rejected before any database
 * lookup. The database only ever stores a hash of the id. This is entirely
 * separate from the leader login's `app_session` cookie and Supabase Auth.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const MEMBER_SESSION_COOKIE = 'member_session';
/** A session lasts this long after its last use (sliding). */
export const MEMBER_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** last_seen_at / expires_at are only rewritten when at least this stale, to avoid a write on every request. */
export const MEMBER_SESSION_TOUCH_AFTER_MS = 60 * 60 * 1000;

function sign(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`session:${sessionId}`).digest('base64url');
}

export function signSessionCookie(sessionId: string, secret: string): string {
  return `${sessionId}.${sign(sessionId, secret)}`;
}

/** The session id inside a cookie value, or null if it is malformed or the signature is wrong. */
export function readSessionCookie(value: string | undefined | null, secret: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const sessionId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(sessionId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return sessionId;
}

/** Options for Set-Cookie: HttpOnly, Secure outside local dev, long-lived. */
export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(MEMBER_SESSION_TTL_MS / 1000),
  };
}
