/**
 * Member portal: who is signed in (first name only). The minimal proof that the
 * session gate works; richer member data builds on `authorizeMemberRequest`.
 *
 * Also re-issues the session cookie with a fresh lifetime. The database session
 * slides (lib/memberSession.ts), but a cookie's expiry is fixed when it is set, so
 * without this a member who uses the portal every day would still lose their cookie
 * 90 days after signing in. Every member page calls this on load.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeMemberRequest } from '@/lib/memberRouteGuard';
import { MEMBER_SESSION_COOKIE, sessionCookieOptions } from '@/lib/memberSession';

export async function GET(request: NextRequest) {
  const auth = await authorizeMemberRequest(request, 'member me');
  if (!auth.ok) return auth.response;

  const response = NextResponse.json({ firstName: auth.member.firstName }, { headers: { 'Cache-Control': 'no-store' } });
  // The guard has already verified this value's signature, so it is safe to hand back unchanged.
  const cookie = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (cookie) response.cookies.set(MEMBER_SESSION_COOKIE, cookie, sessionCookieOptions(process.env.NODE_ENV === 'production'));
  return response;
}
