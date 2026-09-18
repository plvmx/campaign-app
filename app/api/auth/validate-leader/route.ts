/**
 * Server-side login validation. Uses service role to bypass RLS.
 * POST body: { mobile: string, firstName: string }
 * Returns: { matches: Array<{ id, state, leader, admin, email, pendingEmail, suggestedEmail }> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { findVerifiedStateLeaders } from '@/lib/services/leaderVerificationService';
import { getSuggestedEmailByMobile } from '@/lib/services/registrantEmailSuggestionService';

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

    const matches = await findVerifiedStateLeaders(mobile, firstName);

    if (matches.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    // Only worth the registry.registrants lookup (unindexed on phone, ~9,100
    // rows) when at least one match still needs a suggestion — an
    // already-confirmed leader will never see it, so skip the query entirely
    // once every match has an email, keeping the common case cheap. All
    // matches share the same verified mobile, so one lookup covers any that do.
    const suggestedEmail = matches.some((m) => !m.email)
      ? await getSuggestedEmailByMobile(mobile)
      : null;

    return NextResponse.json({
      matches: matches.map((m) => ({
        id:            m.id,
        state:         m.state,
        leader:        m.leader,
        admin:         m.admin,
        email:         m.email,
        pendingEmail:  m.pending_email,
        suggestedEmail,
      })),
    });
  } catch (err) {
    console.error('validate-leader API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
