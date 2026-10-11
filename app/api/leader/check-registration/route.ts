/**
 * Leader-facing "is this person registered?" check against
 * registry.registrants — see lib/services/registrationCheckService.ts for
 * the matching rules and what is deliberately never returned.
 *
 * Goes through the service role because no main-app session can read the
 * registry schema; the caller must therefore be proven here to be a real
 * state_leaders row (any role), not merely signed in.
 *
 * POST body: { firstName, lastName, email?, mobile? }  (email or mobile required)
 * Authorization: Bearer <supabase_access_token>
 * Response: { status: 'registered' | 'name_mismatch' | 'not_registered', matchedOn: ('email' | 'mobile')[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import {
  checkRegistration,
  isSessionForStateLeader,
  parseRegistrationCheckInput,
} from '@/lib/services/registrationCheckService';

// A leader checking the people in front of them needs a handful of lookups;
// these only bite someone working through a list of emails/numbers to see
// who is in the registry. Per IP before auth (looser, since several leaders
// can share one venue's Wi-Fi), then per signed-in user (so one account
// can't dodge the limit by changing network).
const ipRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 60 });
const userRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 30 });

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (ipRateLimiter.isLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many checks. Please wait a few minutes and try again.' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[leader/check-registration] SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    if (userRateLimiter.isLimited(user.id)) {
      return NextResponse.json({ error: 'Too many checks. Please wait a few minutes and try again.' }, { status: 429 });
    }

    if (!(await isSessionForStateLeader(supabaseAdmin, user.id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const parsed = parseRegistrationCheckInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const result = await checkRegistration(supabaseAdmin, parsed.input);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[leader/check-registration] exception:', err);
    return NextResponse.json({ error: 'The check could not be completed. Please try again.' }, { status: 500 });
  }
}
