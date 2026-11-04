'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getCampaignById } from '@/lib/services/campaignService';
import { combinePlaceAndSite } from '@/lib/placeSite';
import { getErrorMessage } from '@/lib/errorUtils';
import {
  REPORT_COUNT_FIELDS,
  NAME_MAX_LENGTH,
  type ReportCountField,
  formatReportDate,
  nameFieldCount,
  resizeNames,
  sanitizeCountInput,
  sanitizeNameInput,
} from '@/lib/campaignReportEntry';

const labelClass = 'block text-lg font-bold text-gray-900 dark:text-gray-100 mb-1';
const inputClass =
  'w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-lg text-gray-900 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-100';
const readOnlyClass = `${inputClass} bg-gray-100 dark:bg-gray-700 cursor-not-allowed`;

interface PrefilledCampaign {
  location: string;
  leader: string;
  date: string;
}

function CampaignReportEntryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignId = searchParams.get('id');
  const returnFilter = searchParams.get('returnFilter') ?? 'past';
  const { user, adminStatus, isLoading: isUserLoading } = useUser();

  const [campaign, setCampaign] = useState<PrefilledCampaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<ReportCountField, string>>({
    partial: '',
    full: '',
    sinnersPrayers: '',
  });
  const [names, setNames] = useState<Record<ReportCountField, string[]>>({
    partial: [],
    full: [],
    sinnersPrayers: [],
  });

  const isFullAdmin = adminStatus === 'AD';

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isFullAdmin) { router.push('/app'); return; }
    if (!campaignId) { setTimeout(() => setError('No campaign was selected.'), 0); return; }

    let cancelled = false;
    getCampaignById(campaignId)
      .then((c) => {
        if (cancelled) return;
        if (!c) { setError('Campaign not found.'); return; }
        setCampaign({
          location: `${combinePlaceAndSite(c.place, c.site)} ${c.state}`.trim(),
          leader: c.leader,
          date: formatReportDate(c.date),
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load campaign'));
      });
    return () => { cancelled = true; };
  }, [isUserLoading, user, isFullAdmin, campaignId, router]);

  const handleCountChange = (field: ReportCountField, raw: string) => {
    const value = sanitizeCountInput(raw);
    setCounts((prev) => ({ ...prev, [field]: value }));
    setNames((prev) => ({ ...prev, [field]: resizeNames(prev[field], nameFieldCount(value)) }));
  };

  const handleNameChange = (field: ReportCountField, index: number, raw: string) => {
    const value = sanitizeNameInput(raw);
    setNames((prev) => ({
      ...prev,
      [field]: prev[field].map((n, i) => (i === index ? value : n)),
    }));
  };

  if (!campaign && !error) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center"><LoadingSpinner /></div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div data-ti="app/record-results/report/page.tsx" className="p-4 bg-blue-50 dark:bg-blue-900/20 min-h-screen">
        <button
          onClick={() => router.push(`/app?filter=${returnFilter}`)}
          className="mb-4 text-base font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline border-2 border-gray-800 dark:border-gray-600 rounded-md px-3 py-1"
        >
          ← Back to Campaigns
        </button>
        <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">TWOL Campaign Report</h1>

        {error && (
          <p className="rounded-md bg-red-100 p-3 text-base font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
        )}

        {campaign && (
          <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
            <div>
              <label htmlFor="report-location" className={labelClass}>Location *</label>
              <input id="report-location" type="text" readOnly value={campaign.location} className={readOnlyClass} />
            </div>
            <div>
              <label htmlFor="report-leader" className={labelClass}>Campaign Leader *</label>
              <input id="report-leader" type="text" readOnly value={campaign.leader} className={readOnlyClass} />
            </div>
            <div>
              <label htmlFor="report-date" className={labelClass}>Campaign Date *</label>
              <input id="report-date" type="text" readOnly value={campaign.date} className={readOnlyClass} />
            </div>

            {REPORT_COUNT_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`report-${key}`} className={labelClass}>{label} *</label>
                <input
                  id={`report-${key}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={counts[key]}
                  onChange={(e) => handleCountChange(key, e.target.value)}
                  className={inputClass}
                />
                {names[key].length > 0 && (
                  <div className="mt-3 space-y-2 pl-3 border-l-4 border-blue-300 dark:border-blue-700">
                    {names[key].map((name, i) => (
                      <input
                        key={i}
                        type="text"
                        autoComplete="off"
                        aria-label={`${label} — name ${i + 1}`}
                        placeholder={`Name ${i + 1}`}
                        maxLength={NAME_MAX_LENGTH}
                        value={name}
                        onChange={(e) => handleNameChange(key, i, e.target.value)}
                        className={inputClass}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* No action yet — saving to campaign_reports comes in a later step. */}
            <button
              type="submit"
              className="w-full rounded-md border-2 border-gray-800 bg-green-600 px-6 py-5 text-2xl font-extrabold text-white hover:bg-green-700 dark:border-gray-600"
            >
              Save
            </button>
          </form>
        )}
      </div>
    </MobileLayout>
  );
}

export default function CampaignReportEntryPage() {
  return (
    <Suspense fallback={
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center"><LoadingSpinner /></div>
      </MobileLayout>
    }>
      <CampaignReportEntryContent />
    </Suspense>
  );
}
