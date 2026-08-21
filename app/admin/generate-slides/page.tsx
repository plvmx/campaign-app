'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { supabase } from '@/lib/supabaseClient';
import { formatDateForDb } from '@/lib/campaignDates';
import { generateAndDownloadSlides } from '@/lib/slideGenerator';
import { getErrorMessage } from '@/lib/errorUtils';
import { AUSTRALIAN_STATES, type AustralianState } from '@/lib/constants';

export default function GenerateSlidesPage() {
  const router = useRouter();
  const { dates: campaignDates } = useCampaignDates();
  const { user, isAdmin, adminStatus, userState, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress]       = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedState, setSelectedState] = useState<AustralianState | ''>('');

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin && adminStatus !== 'SR') {
      setError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, adminStatus, router]);

  // Default to the upcoming two-week campaign period, matching the Campaign
  // Results Report's default range (see app/admin/generate-report/page.tsx)
  useEffect(() => {
    if (campaignDates && !startDate && !endDate) {
      const twoWeekEnd = new Date(campaignDates.upcomingCampaignStart);
      twoWeekEnd.setDate(twoWeekEnd.getDate() + 13);

      setStartDate(formatDateForDb(campaignDates.upcomingCampaignStart));
      setEndDate(formatDateForDb(twoWeekEnd));
    }
  }, [campaignDates, startDate, endDate]);

  const parseDateInput = (value: string): Date => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const handleGenerate = async () => {
    if (!startDate || !endDate) {
      setError('Please select both a start and end date');
      return;
    }
    const start = parseDateInput(startDate);
    const end = parseDateInput(endDate);
    if (end < start) {
      setError('End date must be on or after the start date');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setProgress('Starting list generation…');
    try {
      await generateAndDownloadSlides({
        supabase,
        startDate:   start,
        endDate:     end,
        adminStatus,
        userState,
        stateFilter: isAdmin ? (selectedState || undefined) : undefined,
        onProgress:  setProgress,
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to generate lists'));
    } finally {
      setIsGenerating(false);
    }
  };

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
              {error || 'You do not have permission to access this page.'}
            </p>
            <button
              onClick={() => router.push(adminStatus === 'SR' ? '/app' : '/admin')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <button
            onClick={() => router.push(adminStatus === 'SR' ? '/app' : '/admin')}
            className="mb-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← {adminStatus === 'SR' ? 'Back to Home' : 'Back to Admin Panel'}
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Generate Campaign Lists
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Generate JPEG campaign lists for upcoming campaigns in the standard format
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          </div>
        )}

        {progress && !error && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <p className="text-sm text-blue-800 dark:text-blue-200">{progress}</p>
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Select Date Range
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>

            {isAdmin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  State (optional)
                </label>
                <select
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value as AustralianState | '')}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="">All states</option>
                  {AUSTRALIAN_STATES.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Leave empty to include all states
                </p>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isGenerating ? 'Generating Lists…' : 'Generate Campaign Lists'}
            </button>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
