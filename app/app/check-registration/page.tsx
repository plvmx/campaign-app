'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getErrorMessage } from '@/lib/errorUtils';
import { requestRegistrationCheck } from '@/lib/services/registrationCheckClient';
import {
  parseRegistrationCheckInput,
  type RegistrationCheckResult,
  type RegistrationMatchField,
} from '@/lib/services/registrationCheckService';

const EMPTY_FORM = { firstName: '', lastName: '', email: '', mobile: '' };
type FormField = keyof typeof EMPTY_FORM;

const INPUT_CLASS =
  'mt-1 block w-full rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const LABEL_CLASS = 'block text-sm font-medium text-gray-900 dark:text-gray-100';

const MATCH_FIELD_LABELS: Record<RegistrationMatchField, string> = {
  email: 'email address',
  mobile: 'mobile number',
};

function describeMatchedOn(matchedOn: RegistrationMatchField[]): string {
  return matchedOn.map((field) => MATCH_FIELD_LABELS[field]).join(' and ');
}

/** What was checked, kept alongside the answer so the result can't be misread against edited fields. */
interface CheckedResult {
  result: RegistrationCheckResult;
  name: string;
  /** Typed contact details that did NOT match, when at least one other did. */
  unmatched: RegistrationMatchField[];
}

function ResultCard({ checked }: { checked: CheckedResult }) {
  const { result, name, unmatched } = checked;
  const matched = describeMatchedOn(result.matchedOn);
  const unmatchedNote = unmatched.length > 0 && (
    <p className="mt-2 text-sm">
      Note: the {describeMatchedOn(unmatched)} you entered is not the one on their registration.
    </p>
  );

  if (result.status === 'registered') {
    return (
      <div role="status" className="rounded-lg border-2 border-green-700 bg-green-50 p-4 text-green-900 dark:border-green-600 dark:bg-green-900/20 dark:text-green-100">
        <h2 className="text-lg font-bold">✅ Registered</h2>
        <p className="mt-1 text-sm">
          {name} is registered with AFJ, under the {matched} you entered.
        </p>
        {unmatchedNote}
      </div>
    );
  }

  if (result.status === 'name_mismatch') {
    return (
      <div role="status" className="rounded-lg border-2 border-amber-600 bg-amber-50 p-4 text-amber-900 dark:border-amber-500 dark:bg-amber-900/20 dark:text-amber-100">
        <h2 className="text-lg font-bold">⚠️ Registered under a different name</h2>
        <p className="mt-1 text-sm">
          There is a registration for the {matched} you entered, but not under the name {name}.
        </p>
        <p className="mt-2 text-sm">
          This usually means a different spelling or a shortened name, or that someone else (for example a family
          member sharing the same email) registered with it. Check the spelling with them — if they share an email
          with someone who is registered, they may still need to register themselves.
        </p>
        {unmatchedNote}
      </div>
    );
  }

  return (
    <div role="status" className="rounded-lg border-2 border-gray-800 bg-gray-100 p-4 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
      <h2 className="text-lg font-bold">❌ Not Registered</h2>
      <p className="mt-1 text-sm">
        No registration was found for the email address or mobile number you entered for {name}.
      </p>
      <p className="mt-2 text-sm">
        Before asking them to register, check for typing mistakes and ask whether they may have used a different
        email address or mobile number.
      </p>
    </div>
  );
}

export default function CheckRegistrationPage() {
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useUser();

  const [form, setForm] = useState(EMPTY_FORM);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<CheckedResult | null>(null);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [isUserLoading, user, router]);

  // Editing any field discards the previous answer — a result must only ever
  // be on screen next to the exact details it was for.
  const handleChange = (field: FormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setChecked(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isChecking) return;

    const parsed = parseRegistrationCheckInput(form);
    if (!parsed.ok) {
      setError(parsed.error);
      setChecked(null);
      return;
    }

    setIsChecking(true);
    setError(null);
    setChecked(null);
    try {
      const { input } = parsed;
      const result = await requestRegistrationCheck(input);
      const entered: RegistrationMatchField[] = [
        ...(input.email ? (['email'] as const) : []),
        ...(input.mobile ? (['mobile'] as const) : []),
      ];
      setChecked({
        result,
        name: `${input.firstName} ${input.lastName}`,
        unmatched: result.matchedOn.length > 0 ? entered.filter((field) => !result.matchedOn.includes(field)) : [],
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsChecking(false);
    }
  };

  const handleClear = () => {
    setForm(EMPTY_FORM);
    setChecked(null);
    setError(null);
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

  if (!user) return null;

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Check Registration</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Check whether a member has registered with AFJ. Enter their name and the email address or mobile
            number they would have registered with — both if you have them.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-lg border-2 border-gray-800 bg-white p-4 shadow-sm dark:border-gray-600 dark:bg-gray-800"
        >
          <div>
            <label htmlFor="check-first-name" className={LABEL_CLASS}>First Name</label>
            <input
              id="check-first-name"
              type="text"
              autoComplete="off"
              value={form.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="check-last-name" className={LABEL_CLASS}>Last Name</label>
            <input
              id="check-last-name"
              type="text"
              autoComplete="off"
              value={form.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="check-email" className={LABEL_CLASS}>Email</label>
            <input
              id="check-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="check-mobile" className={LABEL_CLASS}>Mobile</label>
            <input
              id="check-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={form.mobile}
              onChange={(e) => handleChange('mobile', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={isChecking}
              className="rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600 disabled:opacity-60"
            >
              {isChecking ? 'Checking…' : 'Check Registration'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={isChecking}
              className="rounded-md bg-white px-4 py-2 text-base font-bold text-gray-900 hover:bg-gray-100 border-2 border-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
            >
              Clear
            </button>
          </div>
        </form>

        {checked && (
          <div className="mt-4">
            <ResultCard checked={checked} />
          </div>
        )}

        <p className="mt-4 text-xs text-gray-600 dark:text-gray-400">
          This only tells you whether someone is registered — it never shows their registration details. Please use
          it only for people you are working with.
        </p>
      </div>
    </MobileLayout>
  );
}
