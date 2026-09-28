/**
 * Display label for one of a leader's state_leaders rows in the real-auth
 * MFA login role picker (app/login/mfa/callback/page.tsx) — used when a
 * single confirmed user_id has more than one row to choose between (e.g. an
 * AD row in one state plus an SR row in another, or several roles in the
 * same state). AD is app-wide, not state-scoped, so it gets no state suffix;
 * SR is state-scoped and needs one; a plain leader row is labeled by state
 * alone, matching the existing mobile+name multi-state picker's own label
 * for a non-admin match (app/login/page.tsx).
 */
export function getLeaderRoleLabel(admin: string | null, state: string): string {
  if (admin === 'AD') return 'Admin';
  if (admin === 'SR') return `State Reporter — ${state}`;
  return state;
}
