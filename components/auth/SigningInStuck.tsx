import { useEffect, useRef } from 'react';
import { bodyTextClass, headingClass, primaryButtonClass } from '@/components/auth/CodeEntryScreen';
import { GetHelp } from '@/components/auth/GetHelp';

/** How long a magic-link landing page may sit on its "Signing you in…" / "Confirming…" screen before giving up. */
export const STUCK_AFTER_MS = 20000;

/**
 * Calls onStuck once `waiting` has stayed true for STUCK_AFTER_MS, so a
 * magic-link landing page can never freeze on its waiting screen — Peter_AD's
 * phone sat on "Signing you in…" indefinitely (2026-10-14) when a session
 * saved on the device claimed the sign-in and the tapped one was ignored.
 * Restarts whenever `waiting` turns false and back on.
 */
export function useStuckWatchdog(waiting: boolean, onStuck: () => void) {
  const onStuckRef = useRef(onStuck);
  useEffect(() => { onStuckRef.current = onStuck; });
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => onStuckRef.current(), STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
}

/** Card content shown once useStuckWatchdog fires: a way out instead of a frozen screen. */
export function SigningInStuck({ restartHref }: { restartHref: string }) {
  return (
    <>
      <h2 className={headingClass}>This is taking too long</h2>
      <p className={bodyTextClass}>Something got stuck. Please start again — you will get a new email.</p>
      <a href={restartHref} className={`${primaryButtonClass} block text-center`}>Start again</a>
      <GetHelp />
    </>
  );
}
