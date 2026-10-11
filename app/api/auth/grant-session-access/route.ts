/**
 * Server-side grant of a session's user_profiles / user_roles rows — see
 * lib/services/sessionAccessService.ts for what is verified and why this
 * moved off the browser. Bearer token only; supabaseAdmin.auth.getUser is
 * the ONLY trusted source of who is asking.
 *
 * POST body: { method: 'mobile-name', leaderId, mobile, firstName }
 *          | { method: 'real-auth', leaderId }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { getAalFromJwt, grantSessionAccess, type GrantRequest } from '@/lib/services/sessionAccessService';

// Per IP, 20 attempts per 15 minutes — a normal sign-in makes exactly one
// call here (after validate-leader's own 10/15min), so this only bites repeated guessing.
const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });

function parseRequest(body: unknown): GrantRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const leaderId = typeof b.leaderId === 'string' ? b.leaderId : '';
  if (!leaderId || leaderId.length > 100) return null;

  if (b.method === 'real-auth') return { method: 'real-auth', leaderId };
  if (b.method === 'mobile-name') {
    const mobile = typeof b.mobile === 'string' ? b.mobile : '';
    const firstName = typeof b.firstName === 'string' ? b.firstName : '';
    if (!mobile || !firstName || mobile.length > 20 || firstName.length > 100) return null;
    return { method: 'mobile-name', leaderId, mobile, firstName };
  }
  return null;
}

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

    const grantRequest = parseRequest(await request.json().catch(() => null));
    if (!grantRequest) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const result = await grantSessionAccess(supabaseAdmin, {
      userId: user.id,
      aal: getAalFromJwt(token),
      request: grantRequest,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('grant-session-access API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
