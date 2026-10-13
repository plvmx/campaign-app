'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateReadable } from '@/lib/campaignDates';
import { isRecognizedAdminStatus } from '@/lib/campaignFilter';
import { startTwoFactorSignIn } from '@/lib/twoFactorSetup';
import { getErrorMessage } from '@/lib/errorUtils';

export default function TLAdminPage() {
  const router = useRouter();
  const { dates } = useCampaignDates();
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const { user, adminStatus, userState: contextUserState, userProfile, isLoading: isUserLoading } = useUser();

  // Derive access state from context — avoids setState-in-effect anti-pattern
  const derivedUserState = contextUserState ?? userProfile?.state ?? null;
  const accessError = !isUserLoading && user
    ? isRecognizedAdminStatus(adminStatus)
      ? 'Use the main Admin or SR Admin panel instead.'
      : !derivedUserState?.trim()
      ? 'No state found for your account.'
      : null
    : null;
  const hasAccess = !isUserLoading && !!user && accessError === null;

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [isUserLoading, user, router]);

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    );
  }

  if (!user) return null;

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{accessError}</p>
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

  const stateToUse = derivedUserState ?? '';

  const handleSetUpExtraSecurity = async () => {
    setSecurityBusy(true);
    setSecurityError(null);
    try {
      await startTwoFactorSignIn();
    } catch (err: unknown) {
      setSecurityError(getErrorMessage(err, 'Something went wrong. Please try again.'));
      setSecurityBusy(false);
    }
  };

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Team Leader Admin
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Team Leader admin options for your state
          </p>
        </div>

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

          {/* Check Registration */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Check Registration
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Check whether a member has registered with AFJ, using their name and email address or mobile number.
            </p>
            <button
              onClick={() => router.push('/app/check-registration')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Check if a Member is Registered
            </button>
          </div>

          {/* Optional extra security — leaders are no longer asked at every sign-in; it is only
              required to see other people's personal details (RequireTwoFactorForMemberDetails). */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Extra Security
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Optional. Set up two-factor authentication (a code from an authenticator app on your phone). It is needed to see the personal details of people who register interest in your campaigns. You will be signed out and asked to sign in again with your email.
            </p>
            {securityError && (
              <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{securityError}</p>
            )}
            <button
              onClick={handleSetUpExtraSecurity}
              disabled={securityBusy}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
            >
              {securityBusy ? 'Please wait…' : 'Set up extra security'}
            </button>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
