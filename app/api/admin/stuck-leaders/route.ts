/**
 * Admin-only: who is stuck setting up email sign-in / 2FA, and at which step
 * — see lib/services/stuckLeadersService.ts. Caller must be a full admin (AD)
 * signed in with 2FA (lib/services/adminCallerService.ts).
 * GET. Authorization: Bearer <supabase_access_token>
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
import { getStuckLeaders } from '@/lib/services/stuckLeadersService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 60 });

export async function GET(request: NextRequest) {
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

    return NextResponse.json({ leaders: await getStuckLeaders(supabaseAdmin) });
  } catch (err) {
    console.error('stuck-leaders API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
