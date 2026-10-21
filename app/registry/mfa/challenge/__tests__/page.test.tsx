/**
 * Regression test: the authenticator-code box used maxLength={6} on the raw
 * value. Authenticator apps display codes as "123 456" (with a space), so a
 * pasted or space-typed code was cut to "123 45" before it could be cleaned
 * and always rejected as invalid — the national admin could never get past
 * the /registry MFA challenge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockListFactors = vi.fn();
const mockChallengeAndVerify = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      mfa: {
        listFactors: (...a: unknown[]) => mockListFactors(...a),
        challengeAndVerify: (...a: unknown[]) => mockChallengeAndVerify(...a),
      },
    },
  },
}));

vi.mock('@/lib/registryAuth', () => ({ setRegistrySessionCookie: vi.fn() }));
vi.mock('@/app/registry/useRegistryGate', () => ({ useRegistryGate: () => ({ status: 'ready', leaderRole: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import RegistryMfaChallengePage from '../page';

describe('RegistryMfaChallengePage code input', () => {
  beforeEach(() => {
    mockListFactors.mockReset().mockResolvedValue({ data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null });
    mockChallengeAndVerify.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(cleanup);

  it('submits all six digits when the code is entered the way authenticator apps display it ("123 456")', async () => {
    render(<RegistryMfaChallengePage />);
    const input = await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(input, { target: { value: '123 456' } });

    await waitFor(() => expect(screen.getByRole('button', { name: /verify/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(mockChallengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' }));
  });

  it('does not truncate the pasted value before cleaning it', async () => {
    render(<RegistryMfaChallengePage />);
    const input = (await screen.findByLabelText(/6-digit code/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: ' 123 456\n' } });
    expect(input.value).toBe('123456');
  });
});
