import { describe, it, expect } from 'vitest';
import { isIosDevice } from '../isIosDevice';

const nav = (userAgent: string, platform = '', maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints });

describe('isIosDevice', () => {
  it('detects an iPhone', () => {
    expect(isIosDevice(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 'iPhone', 5))).toBe(true);
  });
  it('detects an iPad that reports itself as a Mac', () => {
    expect(isIosDevice(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 'MacIntel', 5))).toBe(true);
  });
  it('is false for a real Mac, Android and Windows', () => {
    expect(isIosDevice(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 0))).toBe(false);
    expect(isIosDevice(nav('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36', 'Linux armv81', 5))).toBe(false);
    expect(isIosDevice(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126', 'Win32', 0))).toBe(false);
  });
  it('is false when there is no navigator (server render)', () => {
    expect(isIosDevice(undefined)).toBe(false);
  });
});
