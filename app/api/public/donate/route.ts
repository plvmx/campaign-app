/**
 * Public, unauthenticated submission endpoint for the optional "let us know
 * you're transferring" notice on /public/donate. Bank-transfer donors only
 * — a card donation goes straight to Donorbox, which captures its own
 * donor details, so there's nothing for this app to collect there.
 *
 * Email-only for now (see CLAUDE.md's Phase 0 donations note): nothing is
 * stored in the database, so there's no RLS consideration here the way
 * register-interest's POST has — this route only reads app_settings
 * (recipients/on-off) and sends an email via Resend.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import {
  DONOR_NAME_MAX_LENGTH,
  DONOR_EMAIL_MAX_LENGTH,
  DONOR_AMOUNT_MAX_LENGTH,
  validateDonationNoticeForm,
  hasDonationNoticeFormErrors,
} from '@/lib/donationNotice';
import { sendDonationNoticeEmail } from '@/lib/services/donationNoticeEmailService';

// Same shape as register-interest's POST limiter — a legitimate visitor
// submits a form a handful of times at most.
const postRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (postRateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const body: unknown = await request.json();
    const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const name = typeof bodyObj.name === 'string' ? bodyObj.name.trim() : '';
    const email = typeof bodyObj.email === 'string' ? bodyObj.email.trim() : '';
    const amount = typeof bodyObj.amount === 'string' ? bodyObj.amount.trim() : '';

    if (name.length > DONOR_NAME_MAX_LENGTH || email.length > DONOR_EMAIL_MAX_LENGTH || amount.length > DONOR_AMOUNT_MAX_LENGTH) {
      return NextResponse.json({ error: 'Please check what you entered' }, { status: 400 });
    }

    const errors = validateDonationNoticeForm({ name, email, amount });
    if (hasDonationNoticeFormErrors(errors)) {
      const firstError = errors.name || errors.email || errors.amount || 'Please check what you entered';
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const result = await sendDonationNoticeEmail(supabaseAdmin, { name, email: email || null, amount: amount || null });
    if (result.status !== 'sent') {
      // An admin hasn't turned this on / listed a recipient yet — not the
      // donor's problem (their transfer still goes through either way), but
      // worth a server-side note so the gap gets noticed and fixed.
      console.warn(`public donate POST: notice email not sent (${result.status})`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('public donate POST exception:', err);
    return NextResponse.json({ error: "Could not send your note just now — please try again, or go ahead with the transfer anyway." }, { status: 500 });
  }
}
