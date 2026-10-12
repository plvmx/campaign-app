'use client';
import { useRouter } from 'next/navigation';

/**
 * Shortcut box shown to full admins at the top of the main feed. Its original
 * download buttons (Campaign Lists, Leader Campaign Lists, Campaign Results,
 * Week 1 Campaigns) and their All States filter were retired 2026-10-12 —
 * the same outputs remain available from the Admin console's generate pages.
 */
export default function AdminQuickActions() {
  const router = useRouter();

  return (
    <div className="mt-4 rounded-lg border-2 border-purple-300 bg-purple-50 p-3 dark:border-purple-700 dark:bg-purple-900/20">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400">
        Admin Quick Actions
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => router.push('/admin/check-registration')}
          className="rounded-md bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600 cursor-pointer"
        >
          Check if a Person is Registered
        </button>
      </div>
    </div>
  );
}
