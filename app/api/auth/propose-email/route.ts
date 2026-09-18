/**
 * Leader self-serve email capture — step 1 of 2 (see confirm-email/route.ts
 * for step 2). POST body: { leaderId, mobile, firstName, email }
 *
 * A bare leaderId is never trusted on its own: the caller must also supply
 * the same mobile+name pair validate-leader already confirmed, re-verified
 * here via findVerifiedStateLeaders — otherwise anyone who observed a
 * leaderId (e.g. in network traffic) could propose an email for a leader
 * they don't actually know the mobile+name for, sending an unwanted
 * magic-link email to whatever address they typed.
 *
 * Writes state_leaders.pending_email and sends a real Supabase magic link
 * to it. Nothing is committed to state_leaders.email until the leader
 * clicks that link and confirm-email/route.ts verifies it — see that
 * file's comment for why signInWithOtp is safe to call server-side here
 * (this project's magic-link flow is implicit/#hash, not PKCE, so there's
 * no browser-bound code verifier tying the send to this request).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isValidEmail } from '@/lib/validation';
import { getSiteUrl } from '@/lib/siteUrl';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { findVerifiedStateLeaders } from '@/lib/services/leaderVerificationService';

// Lower than validate-leader's 10/15min — each successful call sends a real email.
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
    const email     = typeof body.email     === 'string' ? body.email     : '';

    if (!leaderId || mobile.length > 20 || firstName.length > 100 || email.length > 254) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    const verified = await findVerifiedStateLeaders(mobile, firstName);
    const match = verified.find((v) => v.id === leaderId);
    if (!match) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { error: updateError } = await supabaseAdmin
      .from('state_leaders')
      .update({ pending_email: normalizedEmail })
      .eq('id', leaderId);
    if (updateError) {
      console.error('propose-email: failed to write pending_email:', updateError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // leaderId travels with the redirect so confirm-email can scope its commit to
    // THIS specific row rather than any row that happens to share pending_email —
    // otherwise two different leaders proposing the same address (e.g. a shared
    // household email, or one mistyping another's) would let whichever one
    // confirms first silently attach their auth identity to the other's row too.
    const redirectUrl = new URL('/confirm-email', getSiteUrl());
    redirectUrl.searchParams.set('leaderId', leaderId);

    const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectUrl.toString(),
      },
    });
    if (otpError) {
      console.error('propose-email: failed to send magic link:', otpError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('propose-email API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
