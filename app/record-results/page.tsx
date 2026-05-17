'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import CampaignForm, { CampaignData } from '@/components/CampaignForm';
import { getCurrentUser } from '@/lib/auth';
import { getUserStateCode, getCachedStateCode } from '@/lib/location';
import { supabase } from '@/lib/supabaseClient';
import { getUserAdminStatusAndMobile } from '@/lib/campaignFilter';

export default function RecordResultsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [defaultState, setDefaultState] = useState<string>('');
  const [defaultDate, setDefaultDate] = useState<string>('');
  const [signedInLeader, setSignedInLeader] = useState<string | null>(null);
  const [signedInMobile, setSignedInMobile] = useState<string | null>(null);
  const [signedInState, setSignedInState] = useState<string | null>(null);
  const [isAdminOrStateReporter, setIsAdminOrStateReporter] = useState(false);

  useEffect(() => {
    async function checkAuthAndGetDefaults() {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        // Get user's state, leader, mobile, and admin status for form defaults
        const { admin, state, leader, mobile } = await getUserAdminStatusAndMobile();
        const isAdminOrSR = admin === 'AD' || admin === 'SR';
        setIsAdminOrStateReporter(isAdminOrSR);
        if (!isAdminOrSR) {
          setSignedInLeader(leader ?? null);
          setSignedInMobile(mobile ?? null);
          setSignedInState(state ?? null);
        }

        // Set default date to today
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;
        setDefaultDate(todayStr);

        // Try to get cached state first (faster)
        const cachedState = getCachedStateCode();
        if (cachedState) {
          setDefaultState(cachedState);
        } else {
          // If no cache, get state from location
          const { stateCode } = await getUserStateCode();
          if (stateCode) {
            setDefaultState(stateCode);
          }
        }
      } catch (error) {
        router.push('/login');
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthAndGetDefaults();
  }, [router]);

  const handleSubmit = async (data: CampaignData) => {
    // Validate that all required fields are filled
    if (!data.date || !data.state || !data.place || !data.time || !data.leader) {
      throw new Error('Please fill in all fields before recording results.');
    }

    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // Check if user is admin - admins can access any campaign
    const { hasPermission, Permission } = await import('@/lib/permissions');
    const isAdmin = await hasPermission(Permission.ADMIN_ACCESS);
    
    // Check if a campaign exists with the selected values
    let query = supabase
      .from('campaigns')
      .select('id, mobile')
      .eq('date', data.date)
      .eq('state', data.state)
      .eq('place', data.place)
      .eq('time', data.time)
      .eq('leader', data.leader);
    
    const { data: campaigns, error: fetchError } = await query;
    
    if (fetchError) throw fetchError;
    
    // For admins, use first matching campaign; for non-admins, filter by mobile
    let existingCampaign = null;
    if (isAdmin) {
      // Admins can access any campaign matching the criteria
      existingCampaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;
    } else {
      // Non-admin users: filter by mobile and leader (optimized)
      const { getUserAdminStatusAndMobile } = await import('@/lib/campaignFilter');
      const { normalizeMobile } = await import('@/lib/auth');
      const { mobile: userMobile } = await getUserAdminStatusAndMobile();
      
      if (userMobile && campaigns) {
        const normalizedMobile = normalizeMobile(userMobile);
        existingCampaign = campaigns.find(c => 
          c.mobile && normalizeMobile(c.mobile) === normalizedMobile
        );
      } else if (campaigns && campaigns.length > 0) {
        // Fallback: use first match if no mobile filter
        existingCampaign = campaigns[0];
      }
    }
    
    const error = existingCampaign ? null : { message: 'No matching campaign found' };

    if (!existingCampaign) {
      throw new Error(
        'No campaign found with the selected values. Please create the campaign first or select different values.'
      );
    }

    // Campaign exists, proceed to detail screen
    const params = new URLSearchParams({
      date: data.date,
      state: data.state,
      place: data.place,
      time: data.time,
      leader: data.leader,
    });
    router.push(`/record-results/detail?${params.toString()}`);
  };

  if (isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Record Campaign Results
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Select the campaign to record results for
          </p>
        </div>
        <CampaignForm
          onSubmit={handleSubmit}
          initialData={{
            state: !isAdminOrStateReporter && signedInState
              ? signedInState
              : defaultState,
            date: defaultDate,
            ...(!isAdminOrStateReporter && signedInLeader && { leader: signedInLeader }),
            ...(!isAdminOrStateReporter && signedInMobile && { mobile: signedInMobile }),
          }}
          signedInLeader={signedInLeader ?? undefined}
          signedInMobile={signedInMobile ?? undefined}
          signedInState={signedInState ?? undefined}
          isAdminOrStateReporter={isAdminOrStateReporter}
          submitLabel="Record Results"
        />
      </div>
    </MobileLayout>
  );
}

