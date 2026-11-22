/**
 * Member portal: who is signed in (first name only). The minimal proof that the
 * session gate works; richer member data builds on `authorizeMemberRequest`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeMemberRequest } from '@/lib/memberRouteGuard';

export async function GET(request: NextRequest) {
  const auth = await authorizeMemberRequest(request, 'member me');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ firstName: auth.member.firstName }, { headers: { 'Cache-Control': 'no-store' } });
}
