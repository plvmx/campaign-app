/**
 * Shared in-memory, per-IP rate limiter for API routes.
 *
 * Resets across serverless cold starts, which is acceptable for this use
 * case — the goal is to blunt casual abuse, not provide hard guarantees.
 * Each call site keeps its own Map (via createRateLimiter) so limits for
 * different routes don't share a budget.
 */
import { NextRequest } from 'next/server';

export interface RateLimiterOptions {
  /** Rolling window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per IP within the window. */
  maxAttempts: number;
}

export interface RateLimiter {
  /** Returns true if this IP is currently over the limit (request should be rejected). */
  isLimited(ip: string): boolean;
}

/** Creates an independent rate limiter with its own request map. */
export function createRateLimiter({ windowMs, maxAttempts }: RateLimiterOptions): RateLimiter {
  const attempts = new Map<string, { count: number; resetAt: number }>();

  return {
    isLimited(ip: string): boolean {
      const now = Date.now();

      // Prevent unbounded growth: evict expired entries when the map gets large.
      if (attempts.size > 5000) {
        for (const [k, v] of attempts) {
          if (now > v.resetAt) attempts.delete(k);
        }
      }

      const entry = attempts.get(ip);
      if (!entry || now > entry.resetAt) {
        attempts.set(ip, { count: 1, resetAt: now + windowMs });
        return false;
      }
      entry.count++;
      return entry.count > maxAttempts;
    },
  };
}

/**
 * Best-effort client IP extraction from a Next.js request. Falls back to
 * 'unknown' (which shares a single rate-limit bucket) when no header is set —
 * acceptable since this is a UX-level throttle, not the security boundary.
 */
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}
