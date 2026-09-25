/**
 * "Send me a link to set up MFA" — step 1 of 2 (see complete-mfa-setup/
 * route.ts for step 2). POST body: { leaderId, mobile, firstName }.
 *
 * leaderId identifies the SPECIFIC row the leader is currently signed in
 * as, mirroring propose-email/route.ts's own scoping — findVerifiedStateLeaders
 * may return several of a multi-row person's rows (a multi-state leader,
 * or an AD/SR/plain-leader trio), and those rows can carry DIFFERENT
 * confirmed emails if the person signed in and confirmed under different
 * mobile+name pairs. Picking an arbitrary matching row (rather than the
 * one the leader actually clicked "Set up now" from) risks emailing the
 * magic link to an inbox they don't have on hand right now. Re-verify
 * mobile+name via findVerifiedStateLeaders (never trust a bare
 * identifier from the client), confirm leaderId is among the verified
 * matches AND has a confirmed email, then send a real Supabase magic
 * link to that address; completion is handled by app/setup-mfa/page.tsx
 * + complete-mfa-setup/route.ts, not here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { findVerifiedStateLeaders } from '@/lib/services/leaderVerificationService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (rateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const body = await request.json();
    const leaderId  = typeof body.leaderId  === 'string' ? body.leaderId  : '';
    const mobile    = typeof body.mobile    === 'string' ? body.mobile    : '';
    const firstName = typeof body.firstName === 'string' ? body.firstName : '';

    if (!leaderId || mobile.length > 20 || firstName.length > 100) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const verified = await findVerifiedStateLeaders(mobile, firstName);
    const match = verified.find((v) => v.id === leaderId);
    if (!match) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    if (!match.email) {
      // Shouldn't be reachable from the UI (the leader only sees this step
      // once match.email is set on the login page) — but must not
      // silently no-op if it is.
      return NextResponse.json({ error: 'No confirmed email on file yet' }, { status: 400 });
    }

    const redirectUrl = new URL('/setup-mfa', request.nextUrl.origin);

    const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
      email: match.email,
      options: {
        shouldCreateUser: false, // must already exist — created during email confirmation
        emailRedirectTo: redirectUrl.toString(),
      },
    });
    if (otpError) {
      console.error('request-mfa-setup: failed to send magic link:', otpError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('request-mfa-setup API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
