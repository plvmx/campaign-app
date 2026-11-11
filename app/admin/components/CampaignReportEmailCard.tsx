'use client';

import { useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/errorUtils';
import { getCampaignReportEmailConfig, setCampaignReportEmailConfig } from '@/lib/appSettings';
import {
  MAX_REPORT_EMAIL_RECIPIENTS,
  hasRecipientFormErrors,
  validateRecipientForm,
  type RecipientFormErrors,
} from '@/lib/campaignReportEmailSettings';

const emptyBoxes = () => Array<string>(MAX_REPORT_EMAIL_RECIPIENTS).fill('');

/**
 * Admin hub card for the management email sent when a TWOL Campaign Report is
 * saved (`/record-results/report`): an on/off switch and up to four recipient
 * addresses. Validated here for usability and again by /api/admin/settings.
 */
export default function CampaignReportEmailCard() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [boxes, setBoxes] = useState<string[]>(emptyBoxes);
  const [saved, setSaved] = useState<{ enabled: boolean; boxes: string[] } | null>(null);
  const [errors, setErrors] = useState<RecipientFormErrors | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCampaignReportEmailConfig().then((c) => {
      if (cancelled) return;
      const filled = [...c.recipients, ...emptyBoxes()].slice(0, MAX_REPORT_EMAIL_RECIPIENTS);
      setEnabled(c.enabled);
      setBoxes(filled);
      setSaved({ enabled: c.enabled, boxes: filled });
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const changed = saved !== null && (saved.enabled !== enabled || saved.boxes.some((b, i) => b.trim() !== boxes[i].trim()));

  const edit = (apply: () => void) => {
    apply();
    setErrors(null);
    setMessage(null);
    setError(null);
  };

  const save = async () => {
    const found = validateRecipientForm(boxes, enabled);
    setErrors(found);
    if (hasRecipientFormErrors(found)) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const recipients = boxes.map((b) => b.trim()).filter(Boolean);
      await setCampaignReportEmailConfig({ enabled, recipients });
      const tidy = [...recipients, ...emptyBoxes()].slice(0, MAX_REPORT_EMAIL_RECIPIENTS);
      setBoxes(tidy);
      setSaved({ enabled, boxes: tidy });
      setMessage(enabled ? 'Saved. Report emails are on.' : 'Saved. Report emails are off.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save the settings'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-ti="app/admin/components/CampaignReportEmailCard.tsx" className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">TWOL Campaign Report email</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        When a TWOL Campaign Report is saved, email the details (location, leader, date and the four counts — no
        names) to these addresses. Up to {MAX_REPORT_EMAIL_RECIPIENTS}.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span id="report-email-switch-label" className="text-sm font-medium text-gray-800 dark:text-gray-200">
          Send report emails: {!loaded ? 'Loading…' : enabled ? 'On' : 'Off'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="report-email-switch-label"
          disabled={!loaded || busy}
          onClick={() => edit(() => setEnabled((v) => !v))}
          className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 border-gray-800 dark:border-gray-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {boxes.map((value, i) => (
          <div key={i}>
            <label htmlFor={`report-email-recipient-${i}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Email address {i + 1}
            </label>
            <input
              id={`report-email-recipient-${i}`}
              // A phone's address suggestion fills every email-type box that
              // shares a name (here: none) — so each box gets its own name and
              // is a text box with the email keyboard, not type="email".
              name={`report-email-recipient-${i + 1}`}
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              disabled={!loaded || busy}
              value={value}
              onChange={(e) => edit(() => setBoxes((prev) => prev.map((b, j) => (j === i ? e.target.value : b))))}
              aria-invalid={!!errors?.fields[i]}
              aria-describedby={errors?.fields[i] ? `report-email-recipient-${i}-error` : undefined}
              className={`mt-1 block w-full rounded-md border-2 bg-white px-3 py-2 text-base text-gray-900 dark:bg-gray-700 dark:text-gray-100 ${errors?.fields[i] ? 'border-red-600 dark:border-red-500' : 'border-gray-800 dark:border-gray-600'}`}
            />
            {errors?.fields[i] && (
              <p id={`report-email-recipient-${i}-error`} role="alert" className="mt-1 text-sm font-semibold text-red-700 dark:text-red-400">
                {errors.fields[i]}
              </p>
            )}
          </div>
        ))}
      </div>

      {errors?.form && <p role="alert" className="mt-3 text-sm font-semibold text-red-700 dark:text-red-400">{errors.form}</p>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={!loaded || busy || !changed}
        className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>

      {message && <p className="mt-3 text-sm font-semibold text-green-700 dark:text-green-300">{message}</p>}
      {error && <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
