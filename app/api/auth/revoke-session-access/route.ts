/**
 * Called on sign-out: deletes the calling session's user_profiles /
 * user_roles rows (see revokeSessionAccess in
 * lib/services/sessionAccessService.ts). Bearer token only — the session can
 * only ever clear its own identity. Best-effort from the client's side: a
 * failure here never blocks the sign-out itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { revokeSessionAccess } from '@/lib/services/sessionAccessService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 60 });

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

    const result = await revokeSessionAccess(supabaseAdmin, user.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('revoke-session-access API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
