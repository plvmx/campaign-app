'use client';
import { useEffect, type ReactNode } from 'react';

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

  return (
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
    </div>
  );
}
