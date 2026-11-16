/**
 * Shared front door for API routes any signed-in leader may call (the leader
 * counterpart of adminRouteGuard.ts): same-origin, service role configured,
 * Bearer token, and a session that belongs to a `state_leaders` row. Returns
 * the caller on success, or the ready-made error response to send back.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { getLeaderCaller, type LeaderCallerResult } from '@/lib/services/leaderCallerService';

export type LeaderRequestResult =
  | (Extract<LeaderCallerResult, { ok: true }>)
  | { ok: false; response: NextResponse };

export async function authorizeLeaderRequest(request: NextRequest, logTag: string): Promise<LeaderRequestResult> {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return { ok: false, response: corsBlock };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[${logTag}] SUPABASE_SERVICE_ROLE_KEY is not set`);
    return { ok: false, response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  try {
    const result = await getLeaderCaller(supabaseAdmin, token);
    if (!result.ok) return { ok: false, response: NextResponse.json({ error: result.error }, { status: result.status }) };
    return result;
  } catch (err) {
    console.error(`[${logTag}] caller lookup failed:`, err);
    return { ok: false, response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
  }
}
