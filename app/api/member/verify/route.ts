/**
 * Member portal: check the two typed codes and, if both are right, start a
 * session (an httpOnly cookie carrying a signed random id — not a database
 * credential). Wrong, expired, reused and unknown codes all fail with the
 * same generic wording. See docs/member-portal/SIGN_IN_DESIGN.md §6, §7.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { getMemberAuthSecret } from '@/lib/memberCodes';
import { MEMBER_SESSION_COOKIE, sessionCookieOptions, signSessionCookie } from '@/lib/memberSession';
import { parseVerifyBody } from '@/lib/memberSignInInput';
import { buildMemberAuthDeps } from '@/lib/memberAuthDeps';
import { verifyCodes } from '@/lib/services/memberAuthService';

const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 30 });
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;
  const ip = getClientIp(request);
  if (limiter.isLimited(ip)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = parseVerifyBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    const deps = await buildMemberAuthDeps();
    const result = await verifyCodes(supabaseAdmin, deps, parsed.input, { ip, userAgent: request.headers.get('user-agent') });

    if (!result.ok) {
      switch (result.reason) {
        case 'expired':
          return NextResponse.json({ error: 'Those codes have expired — please ask for new ones.', code: 'expired' }, { status: 400, headers: NO_STORE });
        case 'locked':
          return NextResponse.json({ error: 'Too many wrong tries — please ask for new codes.', code: 'locked' }, { status: 400, headers: NO_STORE });
        case 'too_many':
          return NextResponse.json({ error: 'Too many attempts — please try again later.' }, { status: 429, headers: NO_STORE });
        default:
          return NextResponse.json({ error: "Those codes didn't match. Please check them and try again.", code: 'invalid' }, { status: 400, headers: NO_STORE });
      }
    }

    const response = NextResponse.json({ success: true }, { headers: NO_STORE });
    response.cookies.set(
      MEMBER_SESSION_COOKIE,
      signSessionCookie(result.sessionId, getMemberAuthSecret()),
      sessionCookieOptions(process.env.NODE_ENV === 'production'),
    );
    return response;
  } catch (err) {
    console.error('member verify exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
