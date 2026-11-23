/**
 * Front door for member-portal API routes that need a signed-in member
 * (the member counterpart of lib/adminRouteGuard.ts and lib/leaderRouteGuard.ts):
 * same-origin, service role + secret configured, a correctly signed
 * `member_session` cookie, and a live (not revoked/expired) session row.
 * Every future /api/member/* route that returns member data starts here, and
 * must only ever read or write the registrant it returns.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { getMemberAuthSecret } from '@/lib/memberCodes';
import { MEMBER_SESSION_COOKIE, readSessionCookie } from '@/lib/memberSession';
import { getMemberSession, type MemberSession } from '@/lib/services/memberAuthService';

export type MemberRequestResult =
  | { ok: true; member: MemberSession; sessionId: string }
  | { ok: false; response: NextResponse };

export async function authorizeMemberRequest(request: NextRequest, logTag: string): Promise<MemberRequestResult> {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return { ok: false, response: corsBlock };

  let secret: string;
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    secret = getMemberAuthSecret();
  } catch (err) {
    console.error(`[${logTag}]`, err);
    return { ok: false, response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
  }

  const sessionId = readSessionCookie(request.cookies.get(MEMBER_SESSION_COOKIE)?.value, secret);
  if (!sessionId) return { ok: false, response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };

  try {
    const member = await getMemberSession(supabaseAdmin, {}, sessionId);
    if (!member) return { ok: false, response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
    return { ok: true, member, sessionId };
  } catch (err) {
    console.error(`[${logTag}] session lookup failed:`, err);
    return { ok: false, response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
  }
}
