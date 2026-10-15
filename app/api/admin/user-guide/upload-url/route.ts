/**
 * Admin-only: a one-time signed upload target for a new CAS User Guide PDF,
 * which replaces the current one as soon as the browser finishes uploading
 * it — see lib/services/userGuideService.ts. Caller must be a full admin (AD)
 * signed in with 2FA (lib/services/adminCallerService.ts).
 *
 * POST. Authorization: Bearer <supabase_access_token>
 * Response: { path: string, token: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
import { createUserGuideUploadTarget } from '@/lib/services/userGuideService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (rateLimiter.isLimited(getClientIp(request))) {
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

    const target = await createUserGuideUploadTarget(supabaseAdmin);
    console.info(`[admin/user-guide] upload prepared by ${caller.label}: ${target.path}`);
    return NextResponse.json(target);
  } catch (err) {
    console.error('user-guide upload-url API exception:', err);
    return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500 });
  }
}
