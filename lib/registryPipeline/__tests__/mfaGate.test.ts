import { describe, it, expect } from 'vitest';
import { evaluateMfaGate, type MfaGateInput } from '../mfaGate';

const base: MfaGateInput = {
  hasSession: true,
  leaderRole: { role: 'national_admin', mfa_required: true },
  currentLevel: 'aal1',
  hasVerifiedTotpFactor: false,
};

describe('evaluateMfaGate', () => {
  it('sends an unauthenticated visitor to sign in, regardless of anything else', () => {
    expect(evaluateMfaGate({ ...base, hasSession: false, currentLevel: null })).toBe('unauthenticated');
  });

  it('denies a signed-in user with no registry.leader_roles row', () => {
    expect(evaluateMfaGate({ ...base, leaderRole: null })).toBe('no_access');
  });

  it('lets a role that does not require MFA straight through, even at aal1', () => {
    expect(evaluateMfaGate({
      ...base,
      leaderRole: { role: 'state_leader', mfa_required: false },
      currentLevel: 'aal1',
      hasVerifiedTotpFactor: false,
    })).toBe('ok');
  });

  it('requires enrollment for an MFA-required role with no verified factor yet', () => {
    expect(evaluateMfaGate({ ...base, hasVerifiedTotpFactor: false, currentLevel: 'aal1' })).toBe('needs_enrollment');
  });

  it('requires a challenge for an MFA-required role that has enrolled but is only at aal1', () => {
    expect(evaluateMfaGate({ ...base, hasVerifiedTotpFactor: true, currentLevel: 'aal1' })).toBe('needs_challenge');
  });

  it('passes an MFA-required role that has completed the challenge (aal2)', () => {
    expect(evaluateMfaGate({ ...base, hasVerifiedTotpFactor: true, currentLevel: 'aal2' })).toBe('ok');
  });

  it('passes at aal2 even if hasVerifiedTotpFactor were somehow stale/false — aal2 itself proves a factor was verified', () => {
    expect(evaluateMfaGate({ ...base, hasVerifiedTotpFactor: false, currentLevel: 'aal2' })).toBe('ok');
  });
});
