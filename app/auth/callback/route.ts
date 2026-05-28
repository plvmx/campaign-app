import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

function safeRedirectPath(raw: string | null): string {
  // Only allow relative paths that start with '/' but not '//' (protocol-relative URLs).
  // new URL('https://evil.com', origin) ignores the origin, so we must validate first.
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/app';
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = safeRedirectPath(requestUrl.searchParams.get('next'));

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth_failed', requestUrl.origin));
}

