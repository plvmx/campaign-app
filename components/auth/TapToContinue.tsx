'use client';

import { bodyTextClass, headingClass, primaryButtonClass } from '@/components/auth/CodeEntryScreen';

/**
 * The "tap to continue" step of a scanner-proof magic link (see
 * lib/magicLinkToken.ts): the email link only brings the person to this
 * screen; the one-time token isn't used until they press the button, which a
 * mail program that merely opens the link never does. Content only — the
 * caller supplies the card, so each landing page keeps its own look.
 */
export function TapToContinue({
  title,
  description,
  buttonLabel,
  isBusy,
  onTap,
  titleClassName = headingClass,
  bodyClassName = bodyTextClass,
  buttonClassName = primaryButtonClass,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  isBusy: boolean;
  onTap: () => void;
  titleClassName?: string;
  bodyClassName?: string;
  buttonClassName?: string;
}) {
  return (
    <div className="space-y-6">
      <h2 className={titleClassName}>{title}</h2>
      <p className={bodyClassName}>{description}</p>
      <button onClick={onTap} disabled={isBusy} className={buttonClassName}>
        {isBusy ? 'Please wait…' : buttonLabel}
      </button>
    </div>
  );
}
