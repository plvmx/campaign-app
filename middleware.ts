/**
 * Next.js Edge Middleware — route protection
 *
 * Redirects unauthenticated requests away from protected routes before they
 * reach any page component. The main app's check uses a session-indicator
 * cookie (app_session) that is set by lib/auth.ts after a successful
 * Supabase sign-in and cleared on sign-out. The independent /registry
 * portal (real Supabase Auth + MFA, see lib/registryAuth.ts) has its own
 * pair of cookies, deliberately separate from app_session so the two auth
 * systems can't interfere with each other.
 *
 * Important: none of these cookies are cryptographically signed — they are
 * UX-level redirect guards. Supabase Row-Level Security (and, for
 * /registry, registry.has_required_mfa()) is the enforced security
 * boundary for all data access. This middleware prevents casual
 * unauthenticated browsing and satisfies the audit requirement for
 * server-side route protection.
 *
 * A future migration to @supabase/ssr (cookie-based JWT sessions) would allow
 * this middleware to verify the JWT itself, replacing the indicator cookies.
 */
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PREFIXES = ['/app', '/admin', '/capture', '/record-results', '/results', '/view-slides', '/training-interest', '/campaign-interest'];
const LOGIN_PATH = '/login';

// Note: `/public/*` (and its `/api/public/*` data routes) is intentionally
// NOT in PROTECTED_PREFIXES — those routes are meant to be reachable via a
// static link with no login. Each one is responsible for exposing only
// public-safe data server-side (see app/api/public/week1-campaigns/route.ts).

// Reachable with no session at all — the sign-in form, the magic-link
// exchange, and the terminal "you don't have access" page.
const REGISTRY_PUBLIC_PATHS = ['/registry/login', '/registry/auth/callback', '/registry/no-access'];
// Reachable with a session that exists but hasn't cleared the MFA gate yet
// (registry_auth, set right after the code exchange) — anyone further
// along also has registry_session, so this check alone is sufficient here.
const REGISTRY_PARTIAL_AUTH_PATHS = ['/registry/mfa/enroll', '/registry/mfa/challenge'];
const REGISTRY_LOGIN_PATH = '/registry/login';

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  return NextResponse.redirect(url);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/registry')) {
    if (REGISTRY_PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.next();
    }
    if (REGISTRY_PARTIAL_AUTH_PATHS.some((p) => pathname === p)) {
      return request.cookies.has('registry_auth') ? NextResponse.next() : redirectTo(request, REGISTRY_LOGIN_PATH);
    }
    // Every other /registry/* path needs the full, MFA-cleared session.
    return request.cookies.has('registry_session') ? NextResponse.next() : redirectTo(request, REGISTRY_LOGIN_PATH);
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const hasSession = request.cookies.has('app_session');
  if (hasSession) return NextResponse.next();

  // No session cookie — redirect to login, preserving intended destination
  return redirectTo(request, LOGIN_PATH);
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
