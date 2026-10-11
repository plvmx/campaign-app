/**
 * Admin-only: reset a leader's two-factor authentication (lost phone etc.) —
 * see lib/services/mfaResetService.ts. Caller must be a full admin (AD) who
 * signed in with 2FA (lib/services/adminCallerService.ts).
 * POST body: { leaderId: string }
 * Authorization: Bearer <supabase_access_token>
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
import { resetLeaderMfa } from '@/lib/services/mfaResetService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 30 });

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

    const caller = await verifyAdminCaller(supabaseAdmin, token);
    if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const body = await request.json().catch(() => null);
    const leaderId = body && typeof body.leaderId === 'string' ? body.leaderId : '';
    if (!leaderId || leaderId.length > 100) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const result = await resetLeaderMfa(supabaseAdmin, {
      leaderId,
      actorUserId: caller.userId,
      actorLabel: caller.label,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ ok: true, factorsRemoved: result.factorsRemoved, rowsReset: result.rowsReset });
  } catch (err) {
    console.error('reset-mfa API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
