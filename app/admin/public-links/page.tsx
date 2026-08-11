'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { PUBLIC_LINKS } from '@/lib/publicLinks';

export default function PublicLinksPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  // Starts null so the server-rendered and first client-rendered markup match
  // (both show the bare path); filled in after mount to avoid a hydration
  // mismatch from reading window.location during render.
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    // setState is deferred through a resolved Promise to avoid synchronous
    // setState inside the effect body, matching the pattern used elsewhere
    // in the app (see useStateDropdowns.ts).
    Promise.resolve().then(() => setOrigin(window.location.origin));
  }, []);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    Promise.resolve().then(() => {
      if (!isAdmin) {
        setAccessError('You do not have permission to access this page');
        return;
      }
      setHasAccess(true);
    });
  }, [isUserLoading, user, isAdmin, router]);

  const handleCopy = async (path: string, url: string) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath((current) => (current === path ? null : current)), 2000);
    } catch {
      setCopyError(`Could not copy link — copy it manually: ${url}`);
    }
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

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {accessError || 'You do not have permission to access this page.'}
            </p>
            <button
              onClick={() => router.push('/admin')}
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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Public Links</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              No-login links — anyone with the URL can open them. Copy a link below to share it.
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
        </div>

        {copyError && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
            {copyError}
          </div>
        )}

        <div className="space-y-4">
          {PUBLIC_LINKS.map((link) => {
            const url = origin ? `${origin}${link.path}` : link.path;
            return (
              <div
                key={link.path}
                className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800"
              >
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{link.title}</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{link.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <code className="flex-1 min-w-[12rem] break-all rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200">
                    {url}
                  </code>
                  <button
                    onClick={() => handleCopy(link.path, url)}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
                  >
                    {copiedPath === link.path ? 'Copied!' : 'Copy Link'}
                  </button>
                  <a
                    href={link.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                  >
                    Open
                  </a>
                </div>
              </div>
            );
          })}

          {PUBLIC_LINKS.length === 0 && (
            <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 text-center text-sm text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-400">
              No public links yet.
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
