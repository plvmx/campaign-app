'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import CampaignForm, { CampaignData } from '@/components/CampaignForm';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabaseClient';
import { getUserStateCode, getCachedStateCode } from '@/lib/location';
import { logCampaignChange } from '@/lib/campaignLog';
import { getErrorMessage } from '@/lib/errorUtils';
import { getUserAdminStatusAndMobile } from '@/lib/campaignFilter';

export default function CapturePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [defaultState, setDefaultState] = useState<string>('');
  const [signedInLeader, setSignedInLeader] = useState<string | null>(null);
  const [signedInMobile, setSignedInMobile] = useState<string | null>(null);
  const [signedInState, setSignedInState] = useState<string | null>(null);
  const [isAdminOrStateReporter, setIsAdminOrStateReporter] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuthAndGetState() {
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

        // Try to get cached state first (faster)
        const cachedState = getCachedStateCode();
        if (cachedState) {
          setDefaultState(cachedState);
        } else {
          const { stateCode, deniedByUser } = await getUserStateCode();
          if (stateCode) {
            setDefaultState(stateCode);
          } else if (deniedByUser) {
            setLocationNote('Location access was denied. Please select your state manually.');
          }
        }
      } catch (error) {
        // Only redirect to login for auth errors; surface other failures so
        // they don't silently swallow bugs (network issues, DB errors, etc.)
        const msg = error instanceof Error ? error.message : String(error);
        const isAuthError =
          msg.toLowerCase().includes('auth') ||
          msg.toLowerCase().includes('session') ||
          msg.toLowerCase().includes('not authenticated') ||
          msg.toLowerCase().includes('jwt');
        if (isAuthError) {
          router.push('/login');
        } else {
          console.error('Capture page initialisation error:', error);
          setIsLoading(false);
        }
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthAndGetState();
  }, [router]);

  const handleSubmit = async (data: CampaignData) => {
    try {
      // Get the current user (can be anonymous)
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('You must be logged in to create a campaign');
      }

      // Get user's mobile from state_leaders if not provided in form (optimized)
      let mobile = data.mobile || null;
      if (!mobile) {
        const { getUserAdminStatusAndMobile } = await import('@/lib/campaignFilter');
        const { mobile: userMobile } = await getUserAdminStatusAndMobile();
        mobile = userMobile || null;
      }

      const newCampaignData = {
        date: data.date,
        state: data.state,
        place: data.place,
        time: data.time,
        leader: data.leader,
        mobile: mobile,
        botj: data.botj || 'No',
        user_id: user.id,
        created_at: new Date().toISOString(),
        source: 'MAN',
      };

      const { data: insertedData, error } = await supabase
        .from('campaigns')
        .insert([newCampaignData])
        .select()
        .single();

      if (error) throw error;

      // Log the insertion (async, won't block)
      if (insertedData) {
        logCampaignChange(insertedData.id, 'INSERT', null, insertedData);
      }

      // Redirect to app page with success parameter
      router.push('/app?created=true');
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Failed to create campaign'));
    }
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
            // For non-admin users, use their state so leader can default; otherwise use location
            state: !isAdminOrStateReporter && signedInState
              ? signedInState
              : defaultState,
            ...(!isAdminOrStateReporter && signedInLeader && { leader: signedInLeader }),
            ...(!isAdminOrStateReporter && signedInMobile && { mobile: signedInMobile }),
          }}
          signedInLeader={signedInLeader ?? undefined}
          signedInMobile={signedInMobile ?? undefined}
          signedInState={signedInState ?? undefined}
          isAdminOrStateReporter={isAdminOrStateReporter}
        />
      </div>
    </MobileLayout>
  );
}

