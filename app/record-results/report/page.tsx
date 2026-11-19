'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import CampaignReportSummary from '@/components/CampaignReportSummary';
import type { CampaignReportEmailInput } from '@/lib/campaignReportEmail';
import { useUser } from '@/contexts/UserContext';
import { fetchCampaignReport, submitCampaignReport } from '@/lib/services/campaignReportClient';
import { getErrorMessage } from '@/lib/errorUtils';
import {
  REPORT_COUNT_FIELDS,
  NAME_MAX_LENGTH,
  type ReportCountField,
  nameFieldCount,
  resizeNames,
  sanitizeCountInput,
  sanitizeTeamSizeInput,
  validateTeamSize,
  TEAM_SIZE_LABEL,
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
  const { user, isLoading: isUserLoading } = useUser();

  const [campaign, setCampaign] = useState<PrefilledCampaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<ReportCountField, string>>({
    partial: '',
    full: '',
    sinnersPrayers: '',
    followUp: '',
  });
  const [teamSize, setTeamSize] = useState('');
  const [teamSizeError, setTeamSizeError] = useState<string | null>(null);
  const [countErrors, setCountErrors] = useState<Partial<Record<ReportCountField, string>>>({});
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'saved' | 'email-failed'>('idle');
  const [summary, setSummary] = useState<CampaignReportEmailInput | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [nameErrors, setNameErrors] = useState<Partial<Record<ReportCountField, number[]>>>({});
  const [names, setNames] = useState<Record<ReportCountField, string[]>>({
    partial: [],
    full: [],
    sinnersPrayers: [],
    followUp: [],
  });

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!campaignId) { setTimeout(() => setError('No campaign was selected.'), 0); return; }

    let cancelled = false;
    // The server decides whether this leader may record results for the campaign, and returns what is
    // already saved for it so they edit rather than re-type.
    fetchCampaignReport(campaignId)
      .then((view) => {
        if (cancelled) return;
        const saved = {} as Record<ReportCountField, string[]>;
        for (const { key } of REPORT_COUNT_FIELDS) {
          saved[key] = view.names[key].map((n) => sanitizeNameInput(n)).slice(0, 99);
        }
        setCampaign(view.campaign);
        if (view.teamSize) setTeamSize(String(view.teamSize));
        setNames(saved);
        setCounts({
          partial: saved.partial.length ? String(saved.partial.length) : '',
          full: saved.full.length ? String(saved.full.length) : '',
          sinnersPrayers: saved.sinnersPrayers.length ? String(saved.sinnersPrayers.length) : '',
          followUp: saved.followUp.length ? String(saved.followUp.length) : '',
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load campaign'));
      });
    return () => { cancelled = true; };
  }, [isUserLoading, user, campaignId, router]);

  const handleTeamSizeChange = (raw: string) => {
    setSendState('idle');
    setSendError(null);
    setTeamSize(sanitizeTeamSizeInput(raw));
    setTeamSizeError(null);
  };

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
    const teamError = validateTeamSize(teamSize);
    setTeamSizeError(teamError);
    const errors = validateCounts(counts);
    const missingNames = validateNames(names);
    setCountErrors(errors);
    setNameErrors(missingNames);
    if (teamError || Object.keys(errors).length > 0 || Object.keys(missingNames).length > 0 || !campaignId) return;

    setSendState('sending');
    setSendError(null);
    const numericCounts = {
      partial: Number(counts.partial),
      full: Number(counts.full),
      sinnersPrayers: Number(counts.sinnersPrayers),
      followUp: Number(counts.followUp),
    };
    try {
      // Saves the counts and names, then the server emails the counts (never the names) to management.
      // Saving again replaces the earlier save for this campaign.
      const email = await submitCampaignReport(campaignId, Number(teamSize), numericCounts, names);
      setSendState(email === 'sent' ? 'sent' : email === 'failed' ? 'email-failed' : 'saved');
      // What was just saved, for the on-screen summary leaders screenshot (same lines as the email).
      if (campaign) {
        setSummary({ location: campaign.location, leader: campaign.leader, date: campaign.date, teamSize: Number(teamSize), counts: numericCounts });
      }
    } catch (err: unknown) {
      setSendState('idle');
      setSendError(getErrorMessage(err, 'The report could not be saved.'));
    }
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
        {summary && (
          <div className="space-y-5">
            <CampaignReportSummary report={summary} />
            {sendState === 'sent' && (
              <p role="status" className="text-lg font-semibold text-green-700 dark:text-green-300">Report saved and sent to management.</p>
            )}
            {sendState === 'saved' && (
              <p role="status" className="text-lg font-semibold text-green-700 dark:text-green-300">Report saved.</p>
            )}
            {sendState === 'email-failed' && (
              <p role="status" className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                Report saved, but the email to management could not be sent. Please let an administrator know.
              </p>
            )}
            <button
              type="button"
              onClick={() => { setSummary(null); setSendState('idle'); }}
              className="w-full rounded-md border-2 border-gray-800 bg-white px-6 py-4 text-xl font-bold text-gray-900 hover:bg-gray-100 dark:border-gray-600"
            >
              Edit this report
            </button>
          </div>
        )}

        {!summary && <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">TWOL Campaign Report</h1>}

        {error && (
          <p className="rounded-md bg-red-100 p-3 text-base font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
        )}

        {campaign && !summary && (
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

            <div>
              <label htmlFor="report-team-size" className={labelClass}>{TEAM_SIZE_LABEL} *</label>
              <input
                id="report-team-size"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={teamSize}
                onChange={(e) => handleTeamSizeChange(e.target.value)}
                aria-invalid={!!teamSizeError}
                aria-describedby={teamSizeError ? 'report-team-size-error' : undefined}
                className={`${inputClass} ${teamSizeError ? errorInputClass : ''}`}
              />
              {teamSizeError && (
                <p id="report-team-size-error" role="alert" className="mt-1 text-base font-semibold text-red-700 dark:text-red-400">
                  {teamSizeError}
                </p>
              )}
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
              {sendState === 'sending' ? 'Saving…' : 'Save & Submit'}
            </button>
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
