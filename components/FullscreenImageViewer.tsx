'use client';

/**
 * Full-viewport image overlay, always presented in landscape.
 *
 * - On a device that's already landscape (e.g. an iPad turned sideways), the
 *   image simply fills the screen.
 * - On a portrait device (most phones), the image is rotated 90° with CSS so
 *   it reads as landscape without needing the device physically turned.
 *   This is done with plain CSS (not the Screen Orientation API) because
 *   orientation *locking* has no iOS Safari support at all — the CSS rotate
 *   is the one approach that works everywhere.
 * - As a progressive enhancement, also requests real browser Fullscreen
 *   (hides the address bar / chrome) where the API is available; failures
 *   are swallowed since the CSS-rotated overlay already satisfies the
 *   "fullscreen landscape" requirement on its own.
 */
import { useEffect, useRef, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
}

export default function FullscreenImageViewer({ src, alt, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPortrait, setIsPortrait] = useState(
    () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth,
  );

  useEffect(() => {
    const updateOrientation = () => setIsPortrait(window.innerHeight > window.innerWidth);
    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);
    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
    };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Best-effort real fullscreen — silently no-ops where unsupported
    // (notably iOS Safari before 16.4) since the CSS rotate below already
    // makes the image read as landscape and fill the viewport regardless.
    containerRef.current?.requestFullscreen?.().catch(() => {});

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[2000] flex items-center justify-center overflow-hidden bg-black"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close full screen view"
        className="absolute right-3 top-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- object URL, not an optimizable static/remote asset */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={
          isPortrait
            ? {
                width: '100vh',
                height: '100vw',
                maxWidth: 'none',
                maxHeight: 'none',
                transform: 'rotate(90deg)',
                objectFit: 'contain',
              }
            : {
                width: '100vw',
                height: '100vh',
                maxWidth: 'none',
                maxHeight: 'none',
                objectFit: 'contain',
              }
        }
      />
    </div>
  );
}
