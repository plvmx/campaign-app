import Image from 'next/image';
import type { ReactNode } from 'react';

/**
 * Shared shell for every /registry/* auth screen (login, MFA enroll/
 * challenge, no-access) — mirrors app/login/page.tsx's card exactly
 * (same logo, card, and Tailwind classes) so the registry portal reads
 * as part of the same app rather than a bolted-on tool, even though it's
 * a fully independent auth system under the hood.
 */
export function RegistryAuthLayout({ title, children }: { title: string; children: ReactNode }) {
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
          <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Shared field styling — same classes as app/login/page.tsx's inputs. */
export const registryInputClass =
  'mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white';

export const registryLabelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300';

export const registryPrimaryButtonClass =
  'w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600';

export const registrySecondaryButtonClass =
  'w-full rounded-md bg-gray-200 px-4 py-3 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600';

export const registryErrorBannerClass = 'rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200';

export const registryBodyTextClass = 'text-center text-sm text-gray-600 dark:text-gray-400';
