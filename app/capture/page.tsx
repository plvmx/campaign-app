'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import CampaignForm, { CampaignData } from '@/components/CampaignForm';
import { useUser } from '@/contexts/UserContext';
import { getUserStateCode, getCachedStateCode } from '@/lib/location';
import { getErrorMessage } from '@/lib/errorUtils';
import { createCampaign } from '@/lib/services/campaignService';

export default function CapturePage() {
  const router = useRouter();
  const {
    user,
    adminStatus,
    userState,
    userLeader,
    userMobile,
    isLoading: isUserLoading,
  } = useUser();

  const isAdminOrStateReporter = adminStatus === 'AD' || adminStatus === 'SR';

  const [defaultState, setDefaultState] = useState<string>('');
  const [locationNote, setLocationNote] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }

    // Non-admin users: use their own state directly (no location fetch needed)
    if (!isAdminOrStateReporter && userState) {
      setDefaultState(userState);
      return;
    }

    // Try cached location first
    const cachedState = getCachedStateCode();
    if (cachedState) {
      setDefaultState(cachedState);
      return;
    }

    // Fall back to geolocation
    getUserStateCode().then(({ stateCode, deniedByUser }) => {
      if (stateCode) setDefaultState(stateCode);
      else if (deniedByUser) setLocationNote('Location access was denied. Please select your state manually.');
    });
  }, [isUserLoading, user, router, isAdminOrStateReporter, userState]);

  const handleSubmit = async (data: CampaignData) => {
    try {
      if (!user) throw new Error('You must be logged in to create a campaign');
      await createCampaign({
        date: data.date,
        state: data.state,
        place: data.place,
        time: data.time,
        leader: data.leader,
        mobile: data.mobile || userMobile || null,
        category: data.category ?? 'TWOL',
        user_id: user.id,
        source: 'MAN',
      });
      router.push('/app?created=true');
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Failed to create campaign'));
    }
  };

  if (isUserLoading) {
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
            Create Campaign
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Fill in the details to create a new campaign
          </p>
        </div>
        {locationNote && (
          <p className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {locationNote}
          </p>
        )}
        <CampaignForm
          onSubmit={handleSubmit}
          initialData={{
            state: !isAdminOrStateReporter && userState ? userState : defaultState,
            ...(!isAdminOrStateReporter && userLeader && { leader: userLeader }),
            ...(!isAdminOrStateReporter && userMobile && { mobile: userMobile }),
          }}
          signedInLeader={isAdminOrStateReporter ? undefined : userLeader ?? undefined}
          signedInMobile={isAdminOrStateReporter ? undefined : userMobile ?? undefined}
          signedInState={isAdminOrStateReporter ? undefined : userState ?? undefined}
          isAdminOrStateReporter={isAdminOrStateReporter}
        />
      </div>
    </MobileLayout>
  );
}
