import { getCurrentUser } from './auth';
import { supabase } from './supabaseClient';

export enum Permission {
  VIEW_CAMPAIGNS = 'view_campaigns',
  CREATE_CAMPAIGN = 'create_campaign',
  EDIT_CAMPAIGN = 'edit_campaign',
  DELETE_CAMPAIGN = 'delete_campaign',
  VIEW_RESULTS = 'view_results',
  ADMIN_ACCESS = 'admin_access',
}

export interface UserRole {
  role: 'admin' | 'user' | 'viewer';
  permissions: Permission[];
}

const rolePermissions: Record<string, Permission[]> = {
  admin: [
    Permission.VIEW_CAMPAIGNS,
    Permission.CREATE_CAMPAIGN,
    Permission.EDIT_CAMPAIGN,
    Permission.DELETE_CAMPAIGN,
    Permission.VIEW_RESULTS,
    Permission.ADMIN_ACCESS,
  ],
  user: [
    Permission.VIEW_CAMPAIGNS,
    Permission.CREATE_CAMPAIGN,
    Permission.EDIT_CAMPAIGN,
    Permission.VIEW_RESULTS,
  ],
  viewer: [
    Permission.VIEW_CAMPAIGNS,
    Permission.VIEW_RESULTS,
  ],
};

export async function getUserRole(): Promise<UserRole> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Admin status is ONLY determined by state_leaders table with 'AD' value
  try {
    // Get user profile to find name and state
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('name, state')
      .eq('user_id', user.id)
      .single();

    if (profileData?.name && profileData?.state) {
      const normalizedName = profileData.name.trim().toLowerCase();
      const normalizedState = profileData.state.trim().toUpperCase();

      // Filter by both state and leader name at the DB level so we never load
      // the entire state's leaders into memory.
      const { data: leaderDataArray } = await supabase
        .from('state_leaders')
        .select('admin, leader')
        .eq('state', normalizedState)
        .ilike('leader', normalizedName);

      // Only grant admin role if the matched record has admin === 'AD'
      if (leaderDataArray && leaderDataArray.length > 0 && leaderDataArray[0].admin === 'AD') {
        return {
          role: 'admin',
          permissions: rolePermissions.admin,
        };
      }
    }
  } catch (error) {
    // If check fails, continue to default role
    console.warn('Failed to check state_leaders for admin status:', error);
  }

  // Default to 'user' role if no admin status found
  return {
    role: 'user',
    permissions: rolePermissions.user,
  };
}

export async function hasPermission(permission: Permission): Promise<boolean> {
  try {
    const userRole = await getUserRole();
    return userRole.permissions.includes(permission);
  } catch {
    return false;
  }
}

export async function requirePermission(permission: Permission): Promise<void> {
  const hasAccess = await hasPermission(permission);
  if (!hasAccess) {
    throw new Error(`Permission denied: ${permission}`);
  }
}

