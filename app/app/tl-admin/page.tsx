'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { getUserAdminStatusAndMobile } from '@/lib/campaignFilter';
import { getUserProfile } from '@/lib/userProfile';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateReadable } from '@/lib/campaignDates';

export default function TLAdminPage() {
  const router = useRouter();
  const { dates } = useCampaignDates();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [userState, setUserState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkAccess() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.push('/login');
          return;
        }
        const { admin, state } = await getUserAdminStatusAndMobile();
        const isAdmin = admin === 'AD';
        const isSR = admin === 'SR';
        if (isAdmin || isSR) {
          setError('Use the main Admin or SR Admin panel instead.');
          return;
        }
        const stateToUse = state ?? (await getUserProfile())?.state ?? null;
        if (!stateToUse?.trim()) {
          setError('No state found for your account.');
          return;
        }
        setUserState(stateToUse);
        setHasAccess(true);
      } catch (err: any) {
        setError(err.message || 'Access denied');
      } finally {
        setIsLoading(false);
      }
    }
    checkAccess();
  }, [router]);

  if (isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </MobileLayout>
    );
  }

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{error}</p>
            <button
              onClick={() => router.push('/app')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  const stateToUse = userState ?? '';

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            TL Admin
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Team Leader admin options for your state
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          {/* Campaign Dates Info */}
          {dates && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm dark:border-blue-800 dark:bg-blue-900/20">
              <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                Campaign Date Periods
              </h2>
              <p className="mt-2 text-sm text-blue-800 dark:text-blue-200">
                These dates are automatically calculated based on the current day of the week
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Past Campaign Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.pastCampaignStart)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Upcoming Campaign Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.upcomingCampaignStart)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Second Week Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.secondWeekStart)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Campaign Rules */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Rules
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage rules for automatic campaign generation. Create rules for recurring campaigns (weekly, biweekly, monthly) for your state.
            </p>
            <button
              onClick={() => router.push(`/admin/campaign-rules?state=${encodeURIComponent(stateToUse)}`)}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage Campaign Rules
            </button>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
