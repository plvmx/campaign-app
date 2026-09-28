/**
 * Display label for one of a leader's state_leaders rows in the real-auth
 * MFA login role picker (app/login/mfa/callback/page.tsx) — used when a
 * single confirmed user_id has more than one row to choose between (e.g. an
 * AD row in one state plus an SR row in another, or several roles in the
 * same state). AD is app-wide, not state-scoped, so it gets no state suffix;
 * SR is state-scoped and needs one; a plain leader row is labeled "Leader"
 * plus its state, same shape as the SR label (Peter's request, 2026-09-28 —
 * a bare state code read as unlabeled next to "Admin"/"State Reporter").
 */
export function getLeaderRoleLabel(admin: string | null, state: string): string {
  if (admin === 'AD') return 'Admin';
  if (admin === 'SR') return `State Reporter — ${state}`;
  return `Leader — ${state}`;
}
