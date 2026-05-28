/**
 * Next.js Edge Middleware — route protection
 *
 * Redirects unauthenticated requests away from protected routes before they
 * reach any page component. The check uses a session-indicator cookie
 * (app_session) that is set by lib/auth.ts after a successful Supabase sign-in
 * and cleared on sign-out.
 *
 * Important: this cookie is NOT cryptographically signed — it is a UX-level
 * redirect guard. Supabase Row-Level Security is the enforced security boundary
 * for all data access. This middleware prevents casual unauthenticated browsing
 * and satisfies the audit requirement for server-side route protection.
 *
 * A future migration to @supabase/ssr (cookie-based JWT sessions) would allow
 * this middleware to verify the JWT itself, replacing the indicator cookie.
 */
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PREFIXES = ['/app', '/admin', '/capture', '/record-results', '/results', '/view-slides'];
const LOGIN_PATH = '/login';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const hasSession = request.cookies.has('app_session');
  if (hasSession) return NextResponse.next();

  // No session cookie — redirect to login, preserving intended destination
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = LOGIN_PATH;
  loginUrl.search = '';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico, public assets
     * - /login        (the login page itself)
     * - /api/auth/*   (auth API routes — must remain open)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico)|login|api/auth).*)',
  ],
};
