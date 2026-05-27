'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import type { UserProfile } from '@/lib/types';
import { upsertUserProfile } from '@/lib/userProfile';
import { getAuthenticatedUser } from '@/lib/services/authService';
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

  const clearUserState = useCallback(() => {
    setUser(null);
    setUserProfile(null);
    setAdminStatus(null);
    setIsAdmin(false);
    setUserState(null);
    setUserLeader(null);
    setUserMobile(null);
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getAuthenticatedUser();
      if (!result) {
        clearUserState();
        return;
      }
      setUser(result.user);
      setUserProfile(result.profile);
      setAdminStatus(result.adminStatus);
      setIsAdmin(result.isAdmin);
      setUserState(result.userState);
      setUserLeader(result.userLeader);
      setUserMobile(result.userMobile);
    } catch {
      // On any auth error, clear stale state so pages redirect to login
      clearUserState();
    } finally {
      setIsLoading(false);
    }
  }, [clearUserState]);

  useEffect(() => {
    // Initial load on mount.
    load();

    // Re-load whenever the Supabase session changes (login / token refresh).
    // On SIGNED_OUT we clear state synchronously rather than calling load() —
    // this avoids briefly flashing the "Loading your campaigns…" spinner while
    // an async getUser() call completes during the sign-out navigation.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearUserState();
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        load();
      }
    });

    return () => subscription.unsubscribe();
  }, [load, clearUserState]);

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
