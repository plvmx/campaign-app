/**
 * Member portal: sign out this device, or (`{ allDevices: true }`) every device.
 * Always clears the cookie, even if the session was already gone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeMemberRequest } from '@/lib/memberRouteGuard';
import { MEMBER_SESSION_COOKIE } from '@/lib/memberSession';
import { revokeAllMemberSessions, revokeMemberSession } from '@/lib/services/memberAuthService';

export async function POST(request: NextRequest) {
  const auth = await authorizeMemberRequest(request, 'member sign-out');
  if (!auth.ok) {
    // Not signed in is already "signed out" — just make sure the cookie is gone.
    const res = auth.response;
    if (res.status === 401) res.cookies.delete(MEMBER_SESSION_COOKIE);
    return res;
  }

  let allDevices = false;
  try {
    const body: unknown = await request.json();
    allDevices = !!(body && typeof body === 'object' && (body as Record<string, unknown>).allDevices === true);
  } catch { /* no body — this device only */ }

  try {
    if (allDevices) await revokeAllMemberSessions(supabaseAdmin, {}, auth.member.registrantId);
    else await revokeMemberSession(supabaseAdmin, {}, auth.sessionId);
  } catch (err) {
    console.error('member sign-out exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.delete(MEMBER_SESSION_COOKIE);
  return response;
}
