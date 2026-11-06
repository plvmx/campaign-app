'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getCampaignById } from '@/lib/services/campaignService';
import { requestCampaignReportEmail } from '@/lib/services/campaignReportEmailClient';
import { getErrorMessage } from '@/lib/errorUtils';
import {
  REPORT_COUNT_FIELDS,
  NAME_MAX_LENGTH,
  type ReportCountField,
  formatReportDate,
  formatReportLocation,
  nameFieldCount,
  resizeNames,
  sanitizeCountInput,
  sanitizeNameInput,
  validateCounts,
  validateNames,
  NAME_REQUIRED_MESSAGE,
} from '@/lib/campaignReportEntry';

const labelClass = 'block text-lg font-bold text-gray-900 dark:text-gray-100 mb-1';
const inputClass =
  'w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-lg text-gray-900 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-100';
// Shaded, with no white background, so it reads as non-editable.
const readOnlyClass =
  'w-full rounded-md border-2 border-gray-300 bg-gray-200 px-3 py-2 text-lg text-gray-700 cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300';
const errorInputClass = 'border-red-600 dark:border-red-500';

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
  const [countErrors, setCountErrors] = useState<Partial<Record<ReportCountField, string>>>({});
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'off'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [nameErrors, setNameErrors] = useState<Partial<Record<ReportCountField, number[]>>>({});
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
          location: formatReportLocation(c),
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
    setSendState('idle');
    setSendError(null);
    setCounts((prev) => ({ ...prev, [field]: value }));
    setCountErrors((prev) => ({ ...prev, [field]: undefined }));
    setNameErrors((prev) => ({ ...prev, [field]: undefined }));
    setNames((prev) => ({ ...prev, [field]: resizeNames(prev[field], nameFieldCount(value)) }));
  };

  const handleNameChange = (field: ReportCountField, index: number, raw: string) => {
    const value = sanitizeNameInput(raw);
    setSendState('idle');
    setSendError(null);
    setNames((prev) => ({
      ...prev,
      [field]: prev[field].map((n, i) => (i === index ? value : n)),
    }));
    setNameErrors((prev) => {
      const remaining = prev[field]?.filter((i) => i !== index);
      return { ...prev, [field]: remaining?.length ? remaining : undefined };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendState === 'sending') return;
    const errors = validateCounts(counts);
    const missingNames = validateNames(names);
    setCountErrors(errors);
    setNameErrors(missingNames);
    if (Object.keys(errors).length > 0 || Object.keys(missingNames).length > 0 || !campaignId) return;

    setSendState('sending');
    setSendError(null);
    try {
      // Only the counts go to management — names stay in the app.
      const outcome = await requestCampaignReportEmail(campaignId, {
        partial: Number(counts.partial),
        full: Number(counts.full),
        sinnersPrayers: Number(counts.sinnersPrayers),
      });
      setSendState(outcome === 'sent' ? 'sent' : 'off');
    } catch (err: unknown) {
      setSendState('idle');
      setSendError(getErrorMessage(err, 'The report could not be emailed.'));
    }
    // Saving to campaign_reports comes in a later step.
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
          <form onSubmit={handleSave} noValidate className="space-y-5">
            <div>
              <label htmlFor="report-location" className={labelClass}>Location</label>
              <input id="report-location" type="text" readOnly value={campaign.location} className={readOnlyClass} />
            </div>
            <div>
              <label htmlFor="report-leader" className={labelClass}>Campaign Leader</label>
              <input id="report-leader" type="text" readOnly value={campaign.leader} className={readOnlyClass} />
            </div>
            <div>
              <label htmlFor="report-date" className={labelClass}>Campaign Date</label>
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
                  aria-invalid={!!countErrors[key]}
                  aria-describedby={countErrors[key] ? `report-${key}-error` : undefined}
                  className={`${inputClass} ${countErrors[key] ? errorInputClass : ''}`}
                />
                {countErrors[key] && (
                  <p id={`report-${key}-error`} role="alert" className="mt-1 text-base font-semibold text-red-700 dark:text-red-400">
                    {countErrors[key]}
                  </p>
                )}
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
                        aria-invalid={!!nameErrors[key]?.includes(i)}
                        className={`${inputClass} ${nameErrors[key]?.includes(i) ? errorInputClass : ''}`}
                      />
                    ))}
                    {nameErrors[key] && (
                      <p role="alert" className="text-base font-semibold text-red-700 dark:text-red-400">
                        {NAME_REQUIRED_MESSAGE}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}

            <button
              type="submit"
              disabled={sendState === 'sending'}
              className="disabled:cursor-not-allowed disabled:opacity-60 w-full rounded-md border-2 border-gray-800 bg-green-600 px-6 py-5 text-2xl font-extrabold text-white hover:bg-green-700 dark:border-gray-600"
            >
              {sendState === 'sending' ? 'Saving…' : 'Save'}
            </button>
            {sendState === 'sent' && (
              <p role="status" className="text-lg font-semibold text-green-700 dark:text-green-300">Report saved and emailed to management.</p>
            )}
            {sendState === 'off' && (
              <p role="status" className="text-lg font-semibold text-gray-800 dark:text-gray-200">Report saved. Emailing is switched off, so nothing was sent.</p>
            )}
            {sendError && (
              <p role="alert" className="text-lg font-semibold text-red-700 dark:text-red-400">{sendError} Please try again.</p>
            )}
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
