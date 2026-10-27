/**
 * Shared front door for admin-only API routes that need the standard checks:
 * same-origin, service role configured, Bearer token, and a full admin (AD)
 * signed in with 2FA (`verifyAdminCaller`). Returns the caller on success, or
 * the ready-made error response to send back.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';

export type AdminRequestResult =
  | { ok: true; userId: string; label: string }
  | { ok: false; response: NextResponse };

export async function authorizeAdminRequest(request: NextRequest, logTag: string): Promise<AdminRequestResult> {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return { ok: false, response: corsBlock };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[${logTag}] SUPABASE_SERVICE_ROLE_KEY is not set`);
    return { ok: false, response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const caller = await verifyAdminCaller(supabaseAdmin, token);
  if (!caller.ok) return { ok: false, response: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  return { ok: true, userId: caller.userId, label: caller.label };
}
