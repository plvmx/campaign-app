'use client';

import type { ReactNode } from 'react';
import { normalizeOtpInput } from '@/lib/otpInput';

// Shared styling + the 6-digit code entry screen used by every leader-facing
// magic-link identity flow (app/setup-mfa/page.tsx, app/login/mfa/callback)
// so the look and the "verify/back" mechanics stay identical across them
// without duplicating this component per page.

// Sizes are deliberately large (20px body, 30px headings, 20px buttons, 24px
// inputs) — many leaders are older and have trouble reading small text, and
// these are the screens they most need to get through (2026-10-14, Peter's
// request). Keep them large when editing; components/auth/__tests__/setupScreenText.test.ts
// guards the minimums.
export const inputClass =
  'mt-2 block w-full rounded-md border-2 border-gray-400 bg-white px-4 py-3 text-2xl shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white';
export const labelClass = 'block text-lg font-semibold text-gray-800 dark:text-gray-200';
export const primaryButtonClass =
  'w-full rounded-md bg-blue-600 px-4 py-4 text-xl font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600';
export const secondaryButtonClass =
  'w-full py-2 text-lg font-semibold text-blue-700 underline hover:text-blue-800 dark:text-blue-300 disabled:opacity-50';
export const errorBannerClass = 'rounded-md bg-red-50 p-4 text-lg font-medium text-red-800 dark:bg-red-900/20 dark:text-red-200';
export const bodyTextClass = 'text-center text-xl leading-relaxed text-gray-800 dark:text-gray-200';
export const headingClass = 'text-center text-3xl font-bold leading-tight text-gray-900 dark:text-gray-100';
export const cardClass =
  'w-full max-w-xl space-y-6 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-blue-50 p-6 shadow-lg dark:bg-blue-900/20 sm:p-10';

export function CodeEntryScreen({
  title, description, children, code, onCodeChange, onVerify, onBack, backLabel = '← Back', error, isBusy, disabled, stepBadge, help,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  code: string;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onBack: () => void;
  backLabel?: string;
  error: string | null;
  isBusy: boolean;
  disabled: boolean;
  /** e.g. <SetupStep n={2} .../> shown above the title */
  stepBadge?: ReactNode;
  /** e.g. <GetHelp /> shown at the very bottom */
  help?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {stepBadge}
      <h2 className={headingClass}>{title}</h2>
      <p className={bodyTextClass}>{description}</p>
      {children}
      <div>
        <label htmlFor="mfa-code" className={labelClass}>6-digit code from your authenticator app (not from the email)</label>
        <input
          id="mfa-code"
          inputMode="numeric"
          pattern="[0-9]*"
          value={code}
          onChange={(e) => onCodeChange(normalizeOtpInput(e.target.value))}
          className={inputClass}
        />
      </div>
      {error && <p role="alert" className={errorBannerClass}>{error}</p>}
      <button onClick={onVerify} disabled={isBusy || disabled || code.length < 6} className={primaryButtonClass}>
        {isBusy ? 'Verifying…' : 'Verify and continue'}
      </button>
      <button onClick={onBack} disabled={isBusy} className={secondaryButtonClass}>{backLabel}</button>
      {help}
    </div>
  );
}
