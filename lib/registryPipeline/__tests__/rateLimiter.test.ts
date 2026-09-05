import { describe, expect, it } from 'vitest';
import { computeBackoffMs, REQUEST_PACING_MS } from '../rateLimiter';

describe('computeBackoffMs', () => {
  it('honors a numeric Retry-After header, in seconds converted to ms', () => {
    expect(computeBackoffMs('2', 0)).toBe(2000);
  });

  it('honors a Retry-After of 0', () => {
    expect(computeBackoffMs('0', 3)).toBe(0);
  });

  it('falls back to exponential backoff when Retry-After is missing', () => {
    expect(computeBackoffMs(null, 0)).toBe(REQUEST_PACING_MS * 2 ** 0);
    expect(computeBackoffMs(null, 1)).toBe(REQUEST_PACING_MS * 2 ** 1);
    expect(computeBackoffMs(undefined, 2)).toBe(REQUEST_PACING_MS * 2 ** 2);
  });

  it('falls back to exponential backoff when Retry-After is unparseable', () => {
    expect(computeBackoffMs('not-a-number', 1)).toBe(REQUEST_PACING_MS * 2 ** 1);
  });

  it('caps exponential backoff at 30 seconds', () => {
    expect(computeBackoffMs(null, 20)).toBe(30_000);
  });

  it('never backs off below zero attempts', () => {
    expect(computeBackoffMs(null, -1)).toBe(REQUEST_PACING_MS);
  });
});
