'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * Query parameter marking a /public/* page as opened from inside the app
 * (e.g. the Admin Quick Actions buttons), rather than from a shared link.
 */
export const FROM_APP_PARAM = 'from';
const FROM_APP_VALUE = 'app';

/** `path` with the marker that makes `BackToAppBar` show a way back to `/app`. */
export function withBackToApp(path: string): string {
  return `${path}?${FROM_APP_PARAM}=${FROM_APP_VALUE}`;
}

/**
 * Public pages have no app header or bottom bar, so one opened from inside
 * the app left no way back (an installed app has no browser Back button).
 * Shown only when the page was opened via `withBackToApp()` — members who
 * open the same page from a shared link never see it.
 */
export default function BackToAppBar() {
  const searchParams = useSearchParams();
  if (searchParams.get(FROM_APP_PARAM) !== FROM_APP_VALUE) return null;

  return (
    <div data-ti="components/BackToAppBar.tsx" className="sticky top-0 z-10 border-b border-gray-300 bg-gray-100 px-4 py-2 dark:border-gray-800 dark:bg-gray-950">
      <Link
        href="/app"
        className="inline-block rounded-md border-2 border-gray-800 bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700 dark:border-gray-600"
      >
        ← Back to app
      </Link>
    </div>
  );
}
