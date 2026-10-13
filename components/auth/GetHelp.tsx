'use client';

import { buildHelpMessage, getSupportSmsHref, HELP_GUIDE_PATH } from '@/lib/supportContact';

/**
 * "Stuck?" line shown on the email-confirmation and 2FA screens: always a link
 * to the printable step-by-step guide, plus — when NEXT_PUBLIC_SUPPORT_MOBILE
 * is set — a text message to support pre-filled with the step and the person.
 * `step` is plain words for the person reading it ("typing the code from my
 * app"), which also goes into the text so no one has to ask where they got to.
 */
export function GetHelp({ step, who }: { step: string; who?: string | null }) {
  const smsHref = getSupportSmsHref(buildHelpMessage(step, who));
  const linkClass = 'font-semibold text-blue-700 underline dark:text-blue-300';

  return (
    <p className="text-center text-sm text-gray-600 dark:text-gray-400">
      Stuck?{' '}
      <a href={HELP_GUIDE_PATH} target="_blank" rel="noopener noreferrer" className={linkClass}>
        Open the step-by-step guide
      </a>
      {smsHref && (
        <>
          {' '}or{' '}
          <a href={smsHref} className={linkClass}>
            text us for help
          </a>
        </>
      )}
    </p>
  );
}
