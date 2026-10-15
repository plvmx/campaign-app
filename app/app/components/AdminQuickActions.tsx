'use client';
import { useRouter } from 'next/navigation';
import { PUBLIC_LINKS } from '@/lib/publicLinks';
import { withBackToApp } from '@/components/BackToAppBar';

/** Public links offered as shortcuts, by their `lib/publicLinks.ts` slug. */
const QUICK_PUBLIC_LINK_SLUGS = ['week1-campaigns', 'campaign-results'];
const QUICK_PUBLIC_LINKS = QUICK_PUBLIC_LINK_SLUGS.map((slug) => {
  const link = PUBLIC_LINKS.find((l) => l.slug === slug);
  if (!link) throw new Error(`Unknown public link slug: ${slug}`);
  return link;
});

const BUTTON_CLASS =
  'rounded-md bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600 cursor-pointer';

/**
 * Shortcut box shown to full admins at the top of the main feed. Its original
 * download buttons (Campaign Lists, Leader Campaign Lists, Campaign Results,
 * Week 1 Campaigns) and their All States filter were retired 2026-10-12 —
 * the same outputs remain available from the Admin console's generate pages.
 * The Week 1 Campaigns and Campaign Results *public links* are offered here
 * instead (2026-10-16), so an admin can open the same pages members see.
 */
export default function AdminQuickActions() {
  const router = useRouter();

  return (
    <div className="mt-4 rounded-lg border-2 border-purple-300 bg-purple-50 p-3 dark:border-purple-700 dark:bg-purple-900/20">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400">
        Admin Quick Actions
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => router.push('/admin/check-registration')} className={BUTTON_CLASS}>
          Check if a Person is Registered
        </button>
        {QUICK_PUBLIC_LINKS.map((link) => (
          <button key={link.slug} onClick={() => router.push(withBackToApp(link.path))} className={BUTTON_CLASS}>
            {link.title}
          </button>
        ))}
      </div>
    </div>
  );
}
