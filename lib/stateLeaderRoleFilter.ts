import { isRecognizedAdminStatus } from '@/lib/campaignFilter';

/**
 * The "Filter by Role" choices on /admin/state-leaders.
 * '' shows everyone; 'admins' is any admin role (AD or SR).
 */
export type StateLeaderRoleFilter = '' | 'admins' | 'AD' | 'SR' | 'leader';

export const STATE_LEADER_ROLE_FILTER_OPTIONS: ReadonlyArray<{ value: StateLeaderRoleFilter; label: string }> = [
  { value: '', label: 'All Roles' },
  { value: 'admins', label: 'Admins only (AD & SR)' },
  { value: 'AD', label: 'Admin (AD)' },
  { value: 'SR', label: 'State Reporter (SR)' },
  { value: 'leader', label: 'Leaders (no admin role)' },
];

/** Whether a leader row's `admin` value passes the chosen role filter. */
export function matchesStateLeaderRoleFilter(
  admin: string | null | undefined,
  filter: StateLeaderRoleFilter,
): boolean {
  switch (filter) {
    case '':
      return true;
    case 'admins':
      return isRecognizedAdminStatus(admin);
    case 'AD':
    case 'SR':
      return admin === filter;
    case 'leader':
      return !isRecognizedAdminStatus(admin);
  }
}
