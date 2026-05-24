'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import CampaignForm, { CampaignData } from '@/components/CampaignForm';
import { useUser } from '@/contexts/UserContext';
import { getUserStateCode, getCachedStateCode } from '@/lib/location';
import { normalizeMobile } from '@/lib/auth';
import { supabase } from '@/lib/supabaseClient';

export default function RecordResultsPage() {
  const router = useRouter();
  const {
    user,
    isAdmin,
    adminStatus,
    userState: contextUserState,
    userLeader,
    userMobile,
    isLoading: isUserLoading,
  } = useUser();

  const isAdminOrStateReporter = adminStatus === 'AD' || adminStatus === 'SR';
  const [isLoading, setIsLoading] = useState(true);
  const [defaultState, setDefaultState] = useState<string>('');
  const [defaultDate] = useState<string>(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }

    // Resolve default state via an async helper to keep setState out of the
    // synchronous effect body (satisfies react-hooks/set-state-in-effect)
    const resolveDefaultState = async () => {
      if (!isAdminOrStateReporter && contextUserState) {
        setDefaultState(contextUserState);
        setIsLoading(false);
        return;
      }
      const cachedState = getCachedStateCode();
      if (cachedState) {
        setDefaultState(cachedState);
        setIsLoading(false);
        return;
      }
      const { stateCode } = await getUserStateCode();
      if (stateCode) setDefaultState(stateCode);
      setIsLoading(false);
    };

    resolveDefaultState();
  }, [isUserLoading, user, router, isAdminOrStateReporter, contextUserState]);

  const handleSubmit = async (data: CampaignData) => {
    if (!data.date || !data.state || !data.place || !data.time || !data.leader) {
      throw new Error('Please fill in all fields before recording results.');
    }
    if (!user) { router.push('/login'); return; }

    const { data: campaigns, error: fetchError } = await supabase
      .from('campaigns')
      .select('id, mobile')
      .eq('date', data.date)
      .eq('state', data.state)
      .eq('place', data.place)
      .eq('time', data.time)
      .eq('leader', data.leader);

    if (fetchError) throw fetchError;

    let existingCampaign = null;
    if (isAdmin) {
      existingCampaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;
    } else if (campaigns && campaigns.length > 0) {
      if (userMobile) {
        const normalizedMobile = normalizeMobile(userMobile);
        existingCampaign = campaigns.find((c) => c.mobile && normalizeMobile(c.mobile) === normalizedMobile) ?? campaigns[0];
      } else {
        existingCampaign = campaigns[0];
      }
    }

    if (!existingCampaign) {
      throw new Error('No campaign found with the selected values. Please create the campaign first or select different values.');
    }

    router.push(`/record-results/detail?${new URLSearchParams({
      date: data.date, state: data.state, place: data.place, time: data.time, leader: data.leader,
    }).toString()}`);
  };

  if (isUserLoading || isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading campaigns…</div>
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
            state: !isAdminOrStateReporter && contextUserState ? contextUserState : defaultState,
            date: defaultDate,
            ...(!isAdminOrStateReporter && userLeader && { leader: userLeader }),
            ...(!isAdminOrStateReporter && userMobile && { mobile: userMobile }),
          }}
          signedInLeader={isAdminOrStateReporter ? undefined : userLeader ?? undefined}
          signedInMobile={isAdminOrStateReporter ? undefined : userMobile ?? undefined}
          signedInState={isAdminOrStateReporter ? undefined : contextUserState ?? undefined}
          isAdminOrStateReporter={isAdminOrStateReporter}
          submitLabel="Record Results"
        />
      </div>
    </MobileLayout>
  );
}

