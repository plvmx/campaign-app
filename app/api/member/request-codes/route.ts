/**
 * Member portal: send the two sign-in codes (email + text message) to the
 * details we hold for a registrant — from an invite link, or from typed email
 * + mobile that must both belong to the same registrant. Codes are only ever
 * sent to the details ON FILE. Whether anybody matched is never revealed on the
 * typed path: no match answers exactly like a send (with a decoy verification id).
 * See docs/member-portal/SIGN_IN_DESIGN.md §6, §8.
 */
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { maskEmail, maskMobile } from '@/lib/memberMasking';
import { parseRequestCodesBody } from '@/lib/memberSignInInput';
import { buildMemberAuthDeps } from '@/lib/memberAuthDeps';
import { requestCodes } from '@/lib/services/memberAuthService';

// Cheap first line only; the real limits are durable and live in memberThrottle.ts.
const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;
  const ip = getClientIp(request);
  if (limiter.isLimited(ip)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = parseRequestCodesBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    const result = await requestCodes(supabaseAdmin, await buildMemberAuthDeps(), parsed.input, ip);

    switch (result.status) {
      case 'sent':
        return NextResponse.json(
          { success: true, verificationId: result.verificationId, maskedEmail: result.maskedEmail, maskedMobile: result.maskedMobile },
          { headers: NO_STORE },
        );
      case 'no_match':
        if (parsed.input.via === 'invite') {
          return NextResponse.json(
            { error: "We can't sign you in from this link. Please ask us for help." },
            { status: 400, headers: NO_STORE },
          );
        }
        // Typed details: indistinguishable from a real send.
        return NextResponse.json(
          { success: true, verificationId: randomUUID(), maskedEmail: maskEmail(parsed.input.email), maskedMobile: maskMobile(parsed.input.mobile) },
          { headers: NO_STORE },
        );
      case 'throttled':
        return NextResponse.json(
          { error: result.reason === 'cooldown' ? 'Please wait a minute before asking for new codes.' : 'Too many attempts — please try again later.' },
          { status: 429, headers: NO_STORE },
        );
      case 'send_failed':
        return NextResponse.json(
          { error: "We couldn't send your codes just now. Please try again in a few minutes, or ask us for help." },
          { status: 502, headers: NO_STORE },
        );
    }
  } catch (err) {
    console.error('member request-codes exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
