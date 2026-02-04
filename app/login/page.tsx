'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { getSession, signInWithMobileAndName } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [mobile, setMobile] = useState('');
  const [firstName, setFirstName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // Check if user is already signed in
  useEffect(() => {
    async function checkExistingSession() {
      try {
        const session = await getSession();
        if (session) {
          // User is already signed in, redirect to app
          router.push('/app');
          return;
        }
      } catch (error) {
        // No session found, continue to login form
      } finally {
        setCheckingSession(false);
      }
    }
    checkExistingSession();
  }, [router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Validate that both fields are filled
      if (!mobile.trim() || !firstName.trim()) {
        setError('Please enter both mobile number and first name');
        setIsLoading(false);
        return;
      }

      // Sign in with mobile and first name validation
      await signInWithMobileAndName(mobile.trim(), firstName.trim());
      
      // Redirect to app after successful authentication
      router.push('/app');
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate. Please check your mobile number and first name.');
    } finally {
      setIsLoading(false);
    }
  };


  // Show loading while checking for existing session
  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className="w-full max-w-md space-y-6 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-blue-50 p-6 shadow-lg dark:bg-blue-900/20 sm:p-8">
        <div className="flex flex-col items-center">
          <div className="mb-4 flex justify-center">
            <Image
              src="/afj_graphic.png"
              alt="AFJ Graphic"
              width={200}
              height={200}
              className="h-auto w-auto max-w-full"
              priority
            />
          </div>
          <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-gray-100">
            AFJ Campaign Activity System
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            Enter your mobile number and first name<br />to sign in
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="mobile"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Mobile Number
            </label>
            <input
              id="mobile"
              name="mobile"
              type="tel"
              autoComplete="tel"
              required
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              placeholder="e.g., 0429028464 or +61 0429028464"
              inputMode="tel"
            />
          </div>

          <div>
            <label
              htmlFor="firstName"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              First Name
            </label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              autoComplete="given-name"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              placeholder="Enter your first name"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

