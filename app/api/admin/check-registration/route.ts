/**
 * Admin-only: is anyone already registered under this email or mobile? A
 * contact-only version of the leader check (no name asked for or compared) —
 * see lib/services/registrationCheckService.ts. Caller must be a full admin
 * (AD) who signed in with 2FA (lib/services/adminCallerService.ts).
 *
 * POST body: { email?, mobile? }  (at least one)
 * Authorization: Bearer <supabase_access_token>
 * Response: { registered: boolean, matchedOn: ('email' | 'mobile')[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
import { lookupRegistrationByContact, parseContactLookupInput } from '@/lib/services/registrationCheckService';

// Generous next to the leader check's 30 — this is a trusted admin working
// through a list — but still bounded.
const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 200 });

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (rateLimiter.isLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many checks. Please wait a few minutes and try again.' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[admin/check-registration] SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const caller = await verifyAdminCaller(supabaseAdmin, token);
    if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const parsed = parseContactLookupInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    return NextResponse.json(await lookupRegistrationByContact(supabaseAdmin, parsed.input));
  } catch (err) {
    console.error('[admin/check-registration] exception:', err);
    return NextResponse.json({ error: 'The check could not be completed. Please try again.' }, { status: 500 });
  }
}
