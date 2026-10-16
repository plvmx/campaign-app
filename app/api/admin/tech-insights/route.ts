/**
 * Admin-only: the Tech Insights manifest (every route, file, import, table and
 * API call in the app) or, with ?file=<path>, one file's source code — see
 * lib/techInsights/. Caller must be a full admin (AD) signed in with 2FA
 * (lib/services/adminCallerService.ts). The generated data is deliberately
 * never placed in public/ or the client bundle: it describes the app's inner
 * workings and its source code.
 * GET. Authorization: Bearer <supabase_access_token>
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
import { loadManifest, loadSource } from '@/lib/techInsights/manifestStore';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 300 });

export async function GET(request: NextRequest) {
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

    const caller = await verifyAdminCaller(supabaseAdmin, token);
    if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const manifest = loadManifest();
    if (!manifest) {
      return NextResponse.json({ error: 'Tech Insights data has not been generated (run "npm run tech-insights")' }, { status: 503 });
    }

    const file = request.nextUrl.searchParams.get('file');
    if (file !== null) {
      // Only paths the manifest lists — never a caller-supplied filesystem path.
      const source = Object.prototype.hasOwnProperty.call(manifest.files, file) ? loadSource(file) : null;
      if (source === null) return NextResponse.json({ error: 'Unknown file' }, { status: 404 });
      return NextResponse.json({ path: file, source }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    return NextResponse.json({ manifest }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('tech-insights API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
