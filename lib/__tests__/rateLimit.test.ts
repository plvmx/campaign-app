import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRateLimiter } from '../rateLimit';

describe('createRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to maxAttempts, then limits the same IP', () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxAttempts: 3 });
    expect(limiter.isLimited('1.1.1.1')).toBe(false); // 1st
    expect(limiter.isLimited('1.1.1.1')).toBe(false); // 2nd
    expect(limiter.isLimited('1.1.1.1')).toBe(false); // 3rd
    expect(limiter.isLimited('1.1.1.1')).toBe(true);  // 4th — over limit
  });

  it('tracks each IP independently', () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxAttempts: 1 });
    expect(limiter.isLimited('1.1.1.1')).toBe(false);
    expect(limiter.isLimited('2.2.2.2')).toBe(false); // separate bucket
    expect(limiter.isLimited('1.1.1.1')).toBe(true);
  });

  it('resets an IP once the window has elapsed', () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ windowMs: 1000, maxAttempts: 1 });
    expect(limiter.isLimited('1.1.1.1')).toBe(false);
    expect(limiter.isLimited('1.1.1.1')).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(limiter.isLimited('1.1.1.1')).toBe(false);
  });

  it('does not share state between independent limiter instances', () => {
    const a = createRateLimiter({ windowMs: 1000, maxAttempts: 1 });
    const b = createRateLimiter({ windowMs: 1000, maxAttempts: 1 });
    expect(a.isLimited('1.1.1.1')).toBe(false);
    expect(a.isLimited('1.1.1.1')).toBe(true);
    expect(b.isLimited('1.1.1.1')).toBe(false); // b's own budget, unaffected by a
  });
});
