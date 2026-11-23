import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: {} }));

import { parseSmsCeiling } from '../memberAuthDeps';
import { MEMBER_THROTTLE } from '../memberThrottle';

describe('parseSmsCeiling', () => {
  it('uses a positive whole number', () => {
    expect(parseSmsCeiling('250')).toBe(250);
  });
  it('falls back to the default for anything else', () => {
    for (const raw of [null, '', 'abc', '0', '-5', '1.5']) expect(parseSmsCeiling(raw)).toBe(MEMBER_THROTTLE.defaultDailySmsCeiling);
  });
});
