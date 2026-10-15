/**
 * A short-lived link to the current CAS User Guide PDF, for the "OPEN GUIDE"
 * button — see lib/services/userGuideService.ts. The guide lives in a
 * private bucket, so the caller must be proven to be a real state_leaders
 * row (any role), not merely signed in.
 *
 * GET. Authorization: Bearer <supabase_access_token>
 * Response: { url: string, uploadedAt: string } | { url: null } (none uploaded yet)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { isSessionForStateLeader } from '@/lib/services/registrationCheckService';
import { getUserGuideView } from '@/lib/services/userGuideService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 60 });

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (rateLimiter.isLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[leader/user-guide] SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    if (!(await isSessionForStateLeader(supabaseAdmin, user.id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const view = await getUserGuideView(supabaseAdmin);
    return NextResponse.json(view ?? { url: null });
  } catch (err) {
    console.error('[leader/user-guide] exception:', err);
    return NextResponse.json({ error: 'The guide could not be loaded. Please try again.' }, { status: 500 });
  }
}
