'use client';

/**
 * Admin-only preview of the Register Interest screen for the *next*
 * fortnight (the two weeks starting right after the current period the
 * public /public/register-interest page shows). Reached via the "Admin
 * Register Interest" button on /admin, so an admin can check what the
 * public page will look like once the current fortnight rolls over,
 * without waiting for that rollover.
 *
 * Renders the exact same RegisterInterestClient the public page does
 * (copy, layout, validation, submission — all identical), just with
 * `nextPeriod` set. Only this page's own access gate below is
 * admin-specific; the content itself deliberately isn't wrapped in
 * MobileLayout, so it matches the public page pixel-for-pixel.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import RegisterInterestClient from '@/components/registerInterest/RegisterInterestClient';
import { useUser } from '@/contexts/UserContext';

export default function AdminRegisterInterestPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    // setState is deferred through a resolved Promise to avoid synchronous setState
    // inside the effect body, matching the pattern used elsewhere in the app.
    Promise.resolve().then(() => {
      if (!isAdmin) {
        setAccessError('You do not have permission to access this page');
        return;
      }
      setHasAccess(true);
    });
  }, [isUserLoading, user, isAdmin, router]);

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
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
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {accessError || 'You do not have permission to access this page.'}
            </p>
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

  return <RegisterInterestClient nextPeriod />;
}
