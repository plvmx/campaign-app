/**
 * MFA enrollment completion — called by app/setup-mfa/page.tsx right after
 * challengeAndVerify() succeeds (TOTP or phone), before it signs the
 * isolated client back out. Bearer token only; supabaseAdmin.auth.getUser
 * is the ONLY trusted source of identity.
 *
 * The caller must have at least one verified factor on their own session
 * (checked via supabaseAdmin.auth.getUser(token)'s returned user.factors,
 * never trusting the client's word for it) — a valid Bearer token alone
 * isn't proof that challengeAndVerify() actually succeeded; without this
 * check, anyone with a live session for this user_id (e.g. one abandoned
 * before completing enrollment) could mark mfa_enrolled_at without ever
 * having a real factor enrolled.
 *
 * UPDATE ... WHERE user_id = $user.id (no leaderId): MFA enrollment is a
 * property of the person/account, not any one state_leaders row. Safe to
 * scope by user_id alone here — unlike propose/confirm-email, which had
 * to scope by leaderId because identity wasn't yet established at
 * proposal time. By the time this route runs, user_id is already bound
 * to exactly one person via that earlier, leaderId-scoped confirm-email
 * flow — this route only ever touches rows that already carry this exact
 * user_id, so it can't cross into another leader's row. It only reaches
 * rows this person has individually confirmed email on, not necessarily
 * every row findVerifiedStateLeaders would surface as theirs — the same
 * per-row granularity email confirmation already has.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });

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

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    const hasVerifiedFactor = (user.factors ?? []).some((f) => f.status === 'verified');
    if (!hasVerifiedFactor) {
      return NextResponse.json({ error: 'No verified MFA factor found for this session' }, { status: 403 });
    }

    const { error: updateError, count } = await supabaseAdmin
      .from('state_leaders')
      .update({ mfa_enrolled_at: new Date().toISOString() }, { count: 'exact' })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('complete-mfa-setup: failed to write mfa_enrolled_at:', updateError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (!count) {
      // user_id never got bound to a state_leaders row — shouldn't happen
      // via the normal /setup-mfa flow, but don't silently report success.
      return NextResponse.json({ error: 'No matching leader record found for this account' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('complete-mfa-setup API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
