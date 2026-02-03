'use client';

import { ReactNode, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { signOut } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
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

function MobileLayoutNav({ pathname, searchParams, navItems }: { pathname: string; searchParams: URLSearchParams | null; navItems: NavItem[] }) {
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
  const searchParams = useSearchParams();
  return <MobileLayoutNav pathname={pathname} searchParams={searchParams} navItems={navItems} />;
}

export default function MobileLayout({ children }: MobileLayoutProps) {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);

  useEffect(() => {
    async function checkAdminAndSr() {
      try {
        const [adminAccess, { admin: srOrAd }] = await Promise.all([
          hasPermission(Permission.ADMIN_ACCESS),
          getUserAdminStatusAndMobile(),
        ]);
        setIsAdmin(adminAccess);
        setAdminStatus(srOrAd ?? null);
      } catch (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
        setAdminStatus(null);
      }
    }
    checkAdminAndSr();
  }, []);

  // Home and All Campaigns shown to all signed-in users; Admin for AD; SR Admin for SR; TL Admin for TL
  const baseNavItems: NavItem[] = [
    { href: '/app', label: 'Home', icon: '🏠' },
    { href: '/campaign-list', label: 'All Campaigns', iconImage: '/flame_icon.png' },
  ];
  const adminNavItem: NavItem = { href: '/admin', label: 'Admin', icon: '⚙️' };
  const srAdminNavItem: NavItem = { href: '/app/sr-admin', label: 'SR Admin', icon: '⚙️', isSrAdmin: true };
  const tlAdminNavItem: NavItem = { href: '/app/tl-admin', label: 'TL Admin', icon: '⚙️', isTlAdmin: true };

  const navItems: NavItem[] = isAdmin === null
    ? []
    : isAdmin
      ? [...baseNavItems, adminNavItem]
      : adminStatus === 'SR'
        ? [...baseNavItems, srAdminNavItem]
        : [...baseNavItems, tlAdminNavItem];

  const handleSignOut = async () => {
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
            AFJ Campaign Manager
          </h1>
          <button
            onClick={handleSignOut}
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

      {/* Bottom Navigation (Suspense required for useSearchParams during prerender) */}
      <nav className="fixed bottom-0 left-0 right-0 border-t-2 border-gray-800 dark:border-gray-600 bg-white dark:bg-gray-950">
        <Suspense fallback={<MobileLayoutNav pathname={pathname ?? ''} searchParams={null} navItems={navItems} />}>
          <MobileLayoutNavWithSearchParams pathname={pathname ?? ''} navItems={navItems} />
        </Suspense>
      </nav>
    </div>
  );
}

