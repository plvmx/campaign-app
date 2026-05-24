'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { calculateCampaignDates, formatDateForDb } from '@/lib/campaignDates';
import { generateAndDownloadSlides } from '@/lib/slideGenerator';
import { generateAndDownloadReport } from '@/lib/reportGenerator';
import { generateAndDownloadAriseList } from '@/lib/ariseGenerator';
import { trackEvent } from '@/lib/analytics';

interface Props {
  adminStatus: string | null;
  userState: string | null;
}

export default function AdminQuickActions({ adminStatus, userState }: Props) {
  const [isGeneratingSlides, setIsGeneratingSlides] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isGeneratingArise, setIsGeneratingArise] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  const isAnyGenerating = isGeneratingSlides || isGeneratingReport || isGeneratingArise;

  const btnClass = (isThis: boolean) =>
    `rounded-md px-4 py-2 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600 cursor-pointer ${
      isThis
        ? 'bg-gray-400 cursor-not-allowed'
        : isAnyGenerating
        ? 'bg-purple-600 opacity-40 cursor-not-allowed'
        : 'bg-purple-600 hover:bg-purple-700'
    }`;

  const handleSlides = async () => {
    setIsGeneratingSlides(true);
    setError(null);
    setProgress('');
    try {
      const { upcomingCampaignStart } = calculateCampaignDates();
      await generateAndDownloadSlides({ supabase, startDate: upcomingCampaignStart, adminStatus, userState, onProgress: setProgress });
      trackEvent('generate_slides', { state: userState });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate campaign lists');
    } finally {
      setIsGeneratingSlides(false);
    }
  };

  const handleReport = async () => {
    setIsGeneratingReport(true);
    setError(null);
    setProgress('');
    try {
      const { pastCampaignStart } = calculateCampaignDates();
      const pastEnd = new Date(pastCampaignStart);
      pastEnd.setDate(pastEnd.getDate() + 6);
      await generateAndDownloadReport({
        supabase,
        startDate: formatDateForDb(pastCampaignStart),
        endDate: formatDateForDb(pastEnd),
        adminStatus,
        userState,
      });
      trackEvent('generate_report', { state: userState });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate campaign results');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleArise = async () => {
    setIsGeneratingArise(true);
    setError(null);
    setProgress('');
    try {
      const { upcomingCampaignStart } = calculateCampaignDates();
      await generateAndDownloadAriseList({ supabase, startDate: upcomingCampaignStart, adminStatus, userState, onProgress: setProgress });
      trackEvent('generate_week1', { state: userState });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate Week 1 Campaigns list');
    } finally {
      setIsGeneratingArise(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border-2 border-purple-300 bg-purple-50 p-3 dark:border-purple-700 dark:bg-purple-900/20">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400">
        Admin Quick Actions
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={handleSlides} disabled={isAnyGenerating} className={btnClass(isGeneratingSlides)}>
          {isGeneratingSlides ? 'Generating…' : 'Campaign Lists'}
        </button>
        <button onClick={handleReport} disabled={isAnyGenerating} className={btnClass(isGeneratingReport)}>
          {isGeneratingReport ? 'Generating…' : 'Campaign Results'}
        </button>
        <button onClick={handleArise} disabled={isAnyGenerating} className={btnClass(isGeneratingArise)}>
          {isGeneratingArise ? 'Generating…' : 'Week 1 Campaigns'}
        </button>
      </div>
      {progress && !error && <p className="mt-2 text-xs text-purple-700 dark:text-purple-300">{progress}</p>}
      {error && <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">⚠ {error}</p>}
    </div>
  );
}
