'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { getUserProfile, upsertUserProfile, UserProfile } from '@/lib/userProfile';
import { getUserAdminStatusAndMobile } from '@/lib/campaignFilter';
import { hasPermission, Permission } from '@/lib/permissions';
import { supabase } from '@/lib/supabaseClient';

interface UserContextValue {
  user: { id: string; email?: string } | null;
  userProfile: UserProfile | null;
  adminStatus: string | null;
  isAdmin: boolean;
  userState: string | null;
  userLeader: string | null;
  userMobile: string | null;
  isLoading: boolean;
  /** Re-fetch user/profile/admin data (e.g. after profile creation or role change). */
  refresh: () => Promise<void>;
  /** Allow pages to update the profile in context (e.g. after first-login onboarding). */
  updateProfile: (profile: UserProfile | null) => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userState, setUserState] = useState<string | null>(null);
  const [userLeader, setUserLeader] = useState<string | null>(null);
  const [userMobile, setUserMobile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      if (!currentUser) return;

      const [profile, adminData, adminAccess] = await Promise.all([
        getUserProfile(),
        getUserAdminStatusAndMobile(),
        hasPermission(Permission.ADMIN_ACCESS),
      ]);

      setUserProfile(profile);
      setAdminStatus(adminData.admin);
      setIsAdmin(adminAccess);
      setUserState(adminData.state ?? null);
      setUserLeader(adminData.leader ?? null);
      setUserMobile(adminData.mobile ?? null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load on mount.
    load();

    // Re-load whenever the Supabase session changes (login / logout / token
    // refresh).  Without this, navigating to a protected page immediately
    // after signInWithMobileAndName() would still see user === null because
    // the context only loaded once — before the session existed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        load();
      }
    });

    return () => subscription.unsubscribe();
  }, [load]);

  return (
    <UserContext.Provider value={{
      user,
      userProfile,
      adminStatus,
      isAdmin,
      userState,
      userLeader,
      userMobile,
      isLoading,
      refresh: load,
      updateProfile: setUserProfile,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within a UserProvider');
  return ctx;
}

// Re-export helpers that pages need alongside the context, so they don't need
// a separate import for the profile upsert during onboarding.
export { upsertUserProfile };
