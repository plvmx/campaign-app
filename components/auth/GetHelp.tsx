import { HELP_GUIDE_PATH } from '@/lib/supportContact';

/**
 * "Stuck?" line shown on the email-confirmation and 2FA screens: a link to the
 * printable step-by-step guide, plus the place to ask a person — the AFJ TWOL
 * Leaders WhatsApp group (shown on every device, in bold). It used to be a
 * pre-filled "text us for help" `sms:` link, which does nothing on a PC and
 * sent one person's phone every leader's problem; the group is where leaders
 * already ask each other.
 */
export function GetHelp() {
  return (
    <p data-ti="components/auth/GetHelp.tsx" className="text-center text-lg leading-relaxed text-gray-800 dark:text-gray-200">
      Stuck?{' '}
      <a
        href={HELP_GUIDE_PATH}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-blue-700 underline dark:text-blue-300"
      >
        Open the step-by-step guide
      </a>{' '}
      or <strong>ask for help on the AFJ TWOL Leaders WhatsApp group</strong>.
    </p>
  );
}
