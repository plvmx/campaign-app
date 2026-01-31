'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';

interface MobileLayoutProps {
  children: ReactNode;
}

export default function MobileLayout({ children }: MobileLayoutProps) {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkAdminStatus() {
      try {
        const adminAccess = await hasPermission(Permission.ADMIN_ACCESS);
        setIsAdmin(adminAccess);
      } catch (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
      }
    }
    checkAdminStatus();
  }, []);

  // Home and All Campaigns shown to all signed-in users; Admin only for admins
  const baseNavItems = [
    { href: '/app', label: 'Home', icon: '🏠' },
    { href: '/campaign-list', label: 'All Campaigns', iconImage: '/flame_icon.png' },
  ];
  const adminNavItem = { href: '/admin', label: 'Admin', icon: '⚙️' };

  const navItems = isAdmin === null
    ? []
    : isAdmin
      ? [...baseNavItems, adminNavItem]
      : baseNavItems;

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

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 border-t-2 border-gray-800 dark:border-gray-600 bg-white dark:bg-gray-950">
        <div className={`flex items-center ${navItems.length === 1 ? 'justify-center' : 'justify-around'}`}>
          {navItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/app' && pathname?.startsWith(item.href));
            
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
      </nav>
    </div>
  );
}

