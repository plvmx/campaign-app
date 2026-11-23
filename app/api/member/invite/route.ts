/**
 * Member portal: what the sign-in page shows for a customised link
 * (`/member/sign-in?i=<token>`) — the registrant's details, MASKED, and whether
 * they can sign in by themselves. Opening a link proves nothing and consumes
 * nothing; an unknown, revoked or expired token gets one indistinguishable answer.
 * See docs/member-portal/SIGN_IN_DESIGN.md §4.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { isInviteToken } from '@/lib/memberSignInInput';
import { lookupInvite } from '@/lib/services/memberAuthService';

const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 60 });

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;
  if (limiter.isLimited(getClientIp(request))) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const token = request.nextUrl.searchParams.get('i');
  const notValid = NextResponse.json({ error: 'This link is not valid.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!isInviteToken(token)) return notValid;

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    const invite = await lookupInvite(supabaseAdmin, {}, token);
    if (!invite) return notValid;
    return NextResponse.json(
      { maskedEmail: invite.maskedEmail, maskedMobile: invite.maskedMobile, eligible: invite.eligible },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('member invite GET exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
