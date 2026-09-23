/**
 * Leader self-serve email capture — step 2 of 2 (see propose-email/route.ts
 * for step 1). Called by app/confirm-email/page.tsx once the leader has
 * clicked their magic-link and that page's isolated Supabase client
 * (lib/emailConfirmSupabaseClient.ts) has completed the client-side session
 * exchange — this route never sees the magic-link itself.
 *
 * Authorization: Bearer <access_token> — the ONLY trusted source of the
 * confirmed email is supabaseAdmin.auth.getUser(token) below. A
 * client-supplied email string is never used to decide what gets written.
 *
 * Body: { leaderId }. The commit is scoped to this ONE row (id + matching
 * pending_email) rather than every row that happens to share the same
 * pending_email string — propose-email/route.ts only ever verified that
 * THIS leaderId belongs to the caller's mobile+name; two different leaders
 * who happened to propose the same address (a shared household email, or a
 * typo) must each independently prove control of it and each only commits
 * their own row, never each other's.
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

    const body = await request.json().catch(() => ({}));
    const leaderId = typeof body.leaderId === 'string' ? body.leaderId : '';
    if (!leaderId) {
      return NextResponse.json({ error: 'Invalid or expired confirmation link' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user?.email) {
      return NextResponse.json({ error: 'Invalid or expired confirmation link' }, { status: 401 });
    }
    const email = user.email.toLowerCase();

    const { data: existingRow, error: fetchError } = await supabaseAdmin
      .from('state_leaders')
      .select('id, email')
      .eq('id', leaderId)
      .eq('pending_email', email)
      .maybeSingle();
    if (fetchError) {
      console.error('confirm-email: failed to look up pending_email:', fetchError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (!existingRow) {
      return NextResponse.json({ error: 'This confirmation link is no longer valid.' }, { status: 404 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('state_leaders')
      .update({
        email,
        user_id: user.id,
        email_confirmed_at: new Date().toISOString(),
        pending_email: null,
      })
      .eq('id', leaderId)
      .eq('pending_email', email);

    if (updateError) {
      // state_leaders.email has no uniqueness constraint (deliberately — see
      // scripts/drop_state_leaders_email_unique_index.sql: several leaders
      // legitimately hold more than one row in the SAME state — an AD row,
      // an SR row, and/or a plain leader row — and may have only one real
      // email to give all of them). This branch is a generic fallback for
      // any future constraint on these columns, not a currently-reachable
      // path.
      if (updateError.code === '23505') {
        return NextResponse.json(
          { error: 'This email could not be confirmed due to a conflicting record. Contact an admin.' },
          { status: 409 },
        );
      }
      console.error('confirm-email: failed to commit email:', updateError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Best-effort audit trail — never blocks the confirmation that already succeeded above.
    try {
      await supabaseAdmin.from('state_leader_email_changes').insert([
        { state_leader_id: existingRow.id, old_email: existingRow.email, new_email: email, source: 'self-serve' },
      ]);
    } catch (auditErr) {
      console.error('confirm-email: failed to record audit row(s):', auditErr);
    }

    return NextResponse.json({ ok: true, email });
  } catch (err) {
    console.error('confirm-email API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
