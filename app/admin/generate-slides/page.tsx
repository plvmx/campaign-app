'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { generateAndDownloadSlides } from '@/lib/slideGenerator';
import { getErrorMessage } from '@/lib/errorUtils';

/** Returns the default upcoming-campaign Monday based on today's date. */
function calculateDefaultStartDate(): Date {
  const today = new Date();
  const dow   = today.getDay(); // 0=Sun … 6=Sat
  // Mon–Wed (1–3): this week's Monday.  Thu–Sun (4–6, 0): next Monday.
  const pythonDow = dow === 0 ? 6 : dow - 1;
  const offset    = pythonDow <= 2 ? -pythonDow : 7 - pythonDow;
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function GenerateSlidesPage() {
  const router = useRouter();
  const { user, isAdmin, adminStatus, userState, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress]       = useState('');
  const [customStartDate, setCustomStartDate] = useState<string>('');

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin && adminStatus !== 'SR') {
      setError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, adminStatus, router]);

  const getEffectiveStartDate = (): Date => {
    if (customStartDate) {
      const [y, m, d] = customStartDate.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      date.setHours(0, 0, 0, 0);
      return date;
    }
    return calculateDefaultStartDate();
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setProgress('Starting slide generation…');
    try {
      await generateAndDownloadSlides({
        supabase,
        startDate:   getEffectiveStartDate(),
        adminStatus,
        userState,
        onProgress:  setProgress,
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to generate slides'));
    } finally {
      setIsGenerating(false);
    }
  };

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading…</div>
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

  const effectiveStart = getEffectiveStartDate();

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
            Generate Campaign Slides
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Generate JPEG slides for upcoming campaigns in the standard format
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
            Generate Slides
          </h2>

          <div className="space-y-4">
            <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-900/20">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                This will generate slides for the upcoming two-week campaign period, starting from{' '}
                {effectiveStart.toLocaleDateString('en-AU', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                })}.
              </p>
              <p className="mt-2 text-sm text-blue-800 dark:text-blue-200">
                Slides will be generated in portrait format (7.5&quot; × 10&quot;) at 300 DPI and
                downloaded as a ZIP file.
              </p>
            </div>

            <div>
              <label
                htmlFor="startDate"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Start Date (optional)
              </label>
              <input
                id="startDate"
                type="date"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Leave empty to use the default &quot;Upcoming Campaign Start&quot; date
              </p>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isGenerating ? 'Generating Slides…' : 'Generate Campaign Slides'}
            </button>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
