/**
 * CORS origin enforcement for internal API routes.
 *
 * Browser same-origin requests send an Origin header matching the app's host.
 * Cross-origin requests (from other domains) send a mismatched Origin.
 * Server-to-server requests (cron, internal services) send no Origin at all.
 *
 * Call enforceOrigin() at the top of any route handler that should only be
 * reachable from the app itself. Returns a 403 NextResponse if the request is
 * cross-origin, or null if it should proceed.
 *
 * Note: CORS is a browser security feature. It does not prevent non-browser
 * clients (curl, scripts) from calling the endpoint — other auth mechanisms
 * (Bearer token, CRON_SECRET) cover that case.
 */
import { NextRequest, NextResponse } from 'next/server';

export function enforceOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin');

  // No Origin header → same-origin browser request or server-to-server → allow.
  if (!origin) return null;

  const host = request.headers.get('host') ?? '';

  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return null; // Origins match → allow.
  } catch {
    // Malformed Origin header — treat as cross-origin.
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
