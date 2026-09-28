import { describe, it, expect } from 'vitest';
import { getLeaderRoleLabel } from '@/lib/leaderRoleLabel';

describe('getLeaderRoleLabel', () => {
  it('labels an AD row as "Admin" with no state suffix (admin status is app-wide, not state-scoped)', () => {
    expect(getLeaderRoleLabel('AD', 'VIC')).toBe('Admin');
  });

  it('labels an SR row as "State Reporter — <state>" (state reporter is state-scoped)', () => {
    expect(getLeaderRoleLabel('SR', 'QLD')).toBe('State Reporter — QLD');
  });

  it('labels a plain leader row (null admin) as just the state', () => {
    expect(getLeaderRoleLabel(null, 'NSW')).toBe('NSW');
  });

  it('labels an unrecognized admin value (stray legacy data) as just the state, same as a plain leader', () => {
    expect(getLeaderRoleLabel('some-recruiter-name', 'WA')).toBe('WA');
  });
});
