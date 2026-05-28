import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent embedding in iframes on other origins (clickjacking)
  { key: 'X-Frame-Options', value: 'DENY' },
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Only send the origin in the Referer header, never the full path
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Force HTTPS for 2 years, including subdomains
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Restrict browser feature access — geolocation allowed for /capture page
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  // CSP: Next.js requires 'unsafe-inline' for its runtime scripts.
  // 'unsafe-eval' is needed by some Next.js internals in development.
  // Tighten further with nonces once the app migrates to strict-dynamic.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // blob: needed for canvas→JPEG slide/report downloads; data: for inline images
      "img-src 'self' data: blob:",
      // Supabase API + realtime WebSocket connections
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
