import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignOut = vi.fn();
vi.mock('@/lib/auth', () => ({ signOut: (...a: unknown[]) => mockSignOut(...a) }));

import { startTwoFactorSignIn, REQUIRE_TWO_FACTOR_LOGIN_PATH } from '../twoFactorSetup';

const assign = vi.fn();
beforeEach(() => {
  mockSignOut.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true });
});

describe('startTwoFactorSignIn', () => {
  it('signs out first, then goes to the 2FA sign-in', async () => {
    const order: string[] = [];
    mockSignOut.mockImplementation(async () => { order.push('signOut'); });
    assign.mockImplementation(() => { order.push('assign'); });
    await startTwoFactorSignIn();
    expect(order).toEqual(['signOut', 'assign']);
    expect(assign).toHaveBeenCalledWith(REQUIRE_TWO_FACTOR_LOGIN_PATH);
    expect(REQUIRE_TWO_FACTOR_LOGIN_PATH).toBe('/login?require2fa=1');
  });

  it('does not navigate if sign-out fails (the leader would just be bounced back to /app)', async () => {
    mockSignOut.mockRejectedValue(new Error('nope'));
    await expect(startTwoFactorSignIn()).rejects.toThrow('nope');
    expect(assign).not.toHaveBeenCalled();
  });
});
