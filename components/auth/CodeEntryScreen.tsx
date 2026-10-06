'use client';

import type { ReactNode } from 'react';
import { normalizeOtpInput } from '@/lib/otpInput';

// Shared styling + the 6-digit code entry screen used by every leader-facing
// magic-link identity flow (app/setup-mfa/page.tsx, app/login/mfa/callback)
// so the look and the "verify/back" mechanics stay identical across them
// without duplicating this component per page.

export const inputClass =
  'mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white';
export const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300';
export const primaryButtonClass =
  'w-full rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600';
export const secondaryButtonClass =
  'w-full text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50';
export const errorBannerClass = 'rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200';
export const bodyTextClass = 'text-center text-sm text-gray-600 dark:text-gray-400';
export const cardClass =
  'w-full max-w-md space-y-4 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-blue-50 p-6 shadow-lg dark:bg-blue-900/20 sm:p-8';

export function CodeEntryScreen({
  title, description, children, code, onCodeChange, onVerify, onBack, backLabel = '← Back', error, isBusy, disabled,
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
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
      <p className={bodyTextClass}>{description}</p>
      {children}
      <div>
        <label htmlFor="mfa-code" className={labelClass}>6-digit code</label>
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
    </div>
  );
}
