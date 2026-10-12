'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getErrorMessage } from '@/lib/errorUtils';
import { requestAdminRegistrationLookup } from '@/lib/services/registrationCheckClient';
import {
  parseContactLookupInput,
  type ContactLookupResult,
  type RegistrationMatchField,
} from '@/lib/services/registrationCheckService';

const EMPTY_FORM = { mobile: '', email: '' };
type FormField = keyof typeof EMPTY_FORM;

const INPUT_CLASS =
  'mt-1 block w-full rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const LABEL_CLASS = 'block text-sm font-medium text-gray-900 dark:text-gray-100';

const MATCH_FIELD_LABELS: Record<RegistrationMatchField, string> = {
  email: 'email address',
  mobile: 'mobile number',
};

/** The answer, kept with the details it was for so it can't be misread against edited fields. */
interface CheckedResult {
  result: ContactLookupResult;
  entered: Record<RegistrationMatchField, string | null>;
}

function ResultCard({ checked }: { checked: CheckedResult }) {
  const { result, entered } = checked;
  const enteredFields = (['mobile', 'email'] as const).filter((field) => entered[field]);

  if (!result.registered) {
    return (
      <div role="status" className="rounded-lg border-2 border-gray-800 bg-gray-100 p-4 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
        <h2 className="text-lg font-bold">❌ Not Registered</h2>
        <p className="mt-1 text-sm">
          No registration was found for {enteredFields.map((field) => entered[field]).join(' or ')}.
        </p>
      </div>
    );
  }

  return (
    <div role="status" className="rounded-lg border-2 border-green-700 bg-green-50 p-4 text-green-900 dark:border-green-600 dark:bg-green-900/20 dark:text-green-100">
      <h2 className="text-lg font-bold">✅ Registered</h2>
      <ul className="mt-1 space-y-1 text-sm">
        {enteredFields.map((field) => (
          <li key={field}>
            {result.matchedOn.includes(field)
              ? `There is a registration with the ${MATCH_FIELD_LABELS[field]} ${entered[field]}.`
              : `No registration has the ${MATCH_FIELD_LABELS[field]} ${entered[field]}.`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminCheckRegistrationPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();

  const [form, setForm] = useState(EMPTY_FORM);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<CheckedResult | null>(null);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [isUserLoading, user, router]);

  // Editing either field discards the previous answer — a result must only
  // ever be on screen next to the exact details it was for.
  const handleChange = (field: FormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setChecked(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isChecking) return;

    const parsed = parseContactLookupInput(form);
    setChecked(null);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setIsChecking(true);
    setError(null);
    try {
      const result = await requestAdminRegistrationLookup(parsed.input);
      setChecked({ result, entered: parsed.input });
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

  if (!isAdmin) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              You do not have permission to access this page
            </p>
            <button
              onClick={() => router.push('/app')}
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Registry Lookup</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Check whether a person is already registered with AFJ. Enter their mobile number, their email
            address, or both.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-lg border-2 border-gray-800 bg-white p-4 shadow-sm dark:border-gray-600 dark:bg-gray-800"
        >
          <div>
            <label htmlFor="lookup-mobile" className={LABEL_CLASS}>Mobile</label>
            <input
              id="lookup-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={form.mobile}
              onChange={(e) => handleChange('mobile', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="lookup-email" className={LABEL_CLASS}>Email</label>
            <input
              id="lookup-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
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
              {isChecking ? 'Checking…' : 'Check Registry'}
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
      </div>
    </MobileLayout>
  );
}
