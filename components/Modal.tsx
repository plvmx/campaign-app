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
      className={`fixed inset-0 z-50 flex justify-center bg-black/60 p-4 ${
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
