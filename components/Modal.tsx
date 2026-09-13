'use client';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  onClose?: () => void;
  children: ReactNode;
  /** 'bottom' slides up from the bottom on mobile, centers on sm+. Default: 'center'. */
  position?: 'center' | 'bottom';
}

export default function Modal({ onClose, children, position = 'center' }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Portaled straight to <body> rather than rendered in place: a `position:
  // fixed` element is only fixed to the *viewport* if none of its ancestors
  // have a `transform` set — but Leaflet applies `transform: translate3d(...)`
  // to its panes for panning performance, and this component is now also
  // triggered from inside a map popup (components/PublicCampaignInterestActions.tsx),
  // which react-leaflet renders as a real DOM descendant of that transformed
  // pane. Without the portal, the modal would end up positioned relative to
  // the map instead of the screen.
  //
  // No mount-effect delay guard needed here (the usual pattern for a
  // SSR-safe portal): every current/expected caller only ever adds this
  // component to the tree in response to a later client-side state change
  // (e.g. clicking a button), never present on the very first render — so
  // there's nothing for this to mismatch against during SSR, and `document`
  // is always real by the time this actually runs. The `typeof document`
  // check below is just a defensive guard against a future caller that
  // renders this unconditionally from the start.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      // z-[2000]: Leaflet's own panes/controls (used by the campaign map) set
      // z-index up to 1000, which would otherwise render on top of this modal.
      className={`fixed inset-0 z-[2000] flex justify-center bg-black/60 p-4 ${
        position === 'bottom' ? 'items-end sm:items-center' : 'items-center'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
