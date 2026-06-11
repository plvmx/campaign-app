'use client';

import { ReactNode, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { signOut } from '@/lib/auth';
import Modal from '@/components/Modal';
import { getUserAdminStatusAndMobile } from '@/lib/campaignFilter';

interface MobileLayoutProps {
  children: ReactNode;
}

type NavItem = {
  href: string;
  label: string;
  icon?: string;
  iconImage?: string;
  isSrAdmin?: boolean;
  isTlAdmin?: boolean;
};

function MobileLayoutNav({ pathname, navItems }: { pathname: string; navItems: NavItem[] }) {
  return (
    <div className={`flex items-center ${navItems.length === 1 ? 'justify-center' : 'justify-around'}`}>
      {navItems.map((item) => {
        const isActive = item.isSrAdmin
          ? pathname === '/app/sr-admin'
          : item.isTlAdmin
            ? pathname === '/app/tl-admin'
            : item.href === '/app'
              ? pathname === '/app'
              : pathname === item.href || (item.href !== '/app' && pathname?.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-1 px-4 py-3 transition-colors ${
              isActive
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
            }`}
          >
            {'iconImage' in item && item.iconImage ? (
              <img src={item.iconImage} alt="" className="h-6 w-6 object-contain" />
            ) : (
              <span className="text-xl">{item.icon}</span>
            )}
            <span className="text-xs font-medium">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** Uses useSearchParams(); must be rendered inside Suspense for static prerender */
function MobileLayoutNavWithSearchParams({ pathname, navItems }: { pathname: string; navItems: NavItem[] }) {
  void useSearchParams(); // Required for static prerender - triggers client hydration
  return <MobileLayoutNav pathname={pathname} navItems={navItems} />;
}

export default function MobileLayout({ children }: MobileLayoutProps) {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  useEffect(() => {
    async function checkAdminAndSr() {
      try {
        const { admin: srOrAd } = await getUserAdminStatusAndMobile();
        setIsAdmin(srOrAd === 'AD');
        setAdminStatus(srOrAd ?? null);
      } catch (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
        setAdminStatus(null);
      }
    }
    checkAdminAndSr();
  }, []);

  const homeNavItem: NavItem    = { href: '/app',           label: 'Home',    icon: '🏠' };
  const metricsNavItem: NavItem = { href: '/admin/metrics', label: 'Metrics', icon: '📊' };
  const adminNavItem: NavItem   = { href: '/admin',         label: 'Admin',   icon: '⚙️' };
  const srAdminNavItem: NavItem = { href: '/app/sr-admin',  label: 'Admin',    icon: '⚙️', isSrAdmin: true };
  const tlAdminNavItem: NavItem = { href: '/app/tl-admin',  label: 'My Admin', icon: '⚙️', isTlAdmin: true };

  // Full admins (AD): Home | Metrics | Admin
  // State reporters (SR): Home | SR Admin
  // Team leaders: Home | TL Admin
  const navItems: NavItem[] = isAdmin === null
    ? []
    : isAdmin
      ? [homeNavItem, metricsNavItem, adminNavItem]
      : adminStatus === 'SR'
        ? [homeNavItem, srAdminNavItem]
        : [homeNavItem, tlAdminNavItem];

  const handleSignOut = async () => {
    setShowSignOutConfirm(false);
    try {
      await signOut();
      window.location.href = '/login';
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b-2 border-gray-800 dark:border-gray-600 bg-white dark:bg-gray-950">
        <div className="flex h-14 items-center justify-between px-4">
          <h1 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
            AFJ Campaign Activity System
          </h1>
          <button
            onClick={() => setShowSignOutConfirm(true)}
            className="rounded-md px-3 py-1.5 text-base font-bold text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 whitespace-nowrap border-2 border-gray-800 dark:border-gray-600"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
        {children}
      </main>

      {/* Sign-Out Confirmation Modal */}
      {showSignOutConfirm && (
        <Modal onClose={() => setShowSignOutConfirm(false)}>
          <div className="w-full max-w-sm rounded-xl border-2 border-gray-800 bg-white p-6 shadow-2xl dark:border-gray-600 dark:bg-gray-900">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Sign Out?</h2>
            <p className="mt-2 text-base text-gray-600 dark:text-gray-400">
              Are you sure you want to sign out?
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={handleSignOut}
                className="w-full rounded-md bg-red-600 px-4 py-3 text-base font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
              >
                Yes, Sign Out
              </button>
              <button
                onClick={() => setShowSignOutConfirm(false)}
                className="w-full rounded-md bg-gray-200 px-4 py-3 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
              >
                Stay Signed In
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bottom Navigation (Suspense required for useSearchParams during prerender) */}
      <nav className="fixed bottom-0 left-0 right-0 border-t-2 border-gray-800 dark:border-gray-600 bg-white dark:bg-gray-950">
        <Suspense fallback={<MobileLayoutNav pathname={pathname ?? ''} navItems={navItems} />}>
          <MobileLayoutNavWithSearchParams pathname={pathname ?? ''} navItems={navItems} />
        </Suspense>
      </nav>
    </div>
  );
}

