/**
 * Server-side login validation. Uses service role to bypass RLS.
 * POST body: { mobile: string, firstName: string }
 * Returns: { matches: Array<{ id, state, leader, admin }> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeMobile, normalizeName } from '@/lib/auth';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

// Rate limiting — in-memory, per IP, 10 attempts per 15 minutes.
const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
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
    const mobile    = typeof body.mobile    === 'string' ? body.mobile    : '';
    const firstName = typeof body.firstName === 'string' ? body.firstName : '';

    // Input length guards — prevent excessively large payloads reaching the DB.
    if (mobile.length > 20 || firstName.length > 100) {
      return NextResponse.json({ matches: [] });
    }

    const mobileNormalized    = normalizeMobile(mobile);
    const firstNameNormalized = normalizeName(firstName);

    if (!mobileNormalized || !firstNameNormalized) {
      return NextResponse.json({ matches: [] });
    }

    // Prefix-match on leader name to limit the result set while still tolerating
    // trailing whitespace in stored values (e.g. "Rosheen "). The JS filter below
    // enforces an exact normalised-name match, so "Rosh" will never match "Rosheen".
    const { data, error } = await supabaseAdmin
      .from('state_leaders')
      .select('id, state, leader, mobile, admin')
      .ilike('leader', `${firstNameNormalized}%`);

    if (error) {
      console.error('validate-leader API error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    // Exact name + mobile verification in JS — filters out prefix-only matches.
    const matches = data.filter((rec: { mobile?: string; leader?: string }) => {
      const storedNameNormalized = normalizeName(rec.leader ?? '');
      if (storedNameNormalized !== firstNameNormalized) return false;
      const mobileValue = rec.mobile;
      if (!mobileValue) return false;
      return normalizeMobile(mobileValue) === mobileNormalized;
    });

    return NextResponse.json({
      matches: matches.map((m: { id: string; state: string; leader: string; admin: string | null }) => ({
        id:     m.id,
        state:  m.state,
        leader: m.leader,
        admin:  m.admin,
      })),
    });
  } catch (err) {
    console.error('validate-leader API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
