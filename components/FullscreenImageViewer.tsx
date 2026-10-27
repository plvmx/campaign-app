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
 * - Easy to leave on a phone: a large labelled Close button, tapping anywhere
 *   closes, and the phone's Back gesture/button closes it too (the viewer
 *   pushes one history entry while open, so Back returns to the page instead
 *   of leaving it). Leaving real fullscreen (e.g. swipe down) also closes it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
}

export default function FullscreenImageViewer({ src, alt, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const pushedHistoryRef = useRef(false);
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
    onCloseRef.current = onClose;
  }, [onClose]);

  // Every close goes through here: if we pushed a history entry, popping it
  // (popstate below) is what actually closes, so Back and the Close button
  // behave identically and no stray entry is left behind.
  const close = useCallback(() => {
    if (pushedHistoryRef.current) {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const handlePopState = () => {
      pushedHistoryRef.current = false;
      onCloseRef.current();
    };
    let enteredFullscreen = false;
    const handleFullscreenChange = () => {
      if (enteredFullscreen && !document.fullscreenElement) close();
    };
    document.addEventListener('keydown', handleKey);
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // Guarded so React Strict Mode's dev-only mount/unmount/mount can't stack two entries.
    if (!window.history.state?.fullscreenImageViewer) {
      window.history.pushState({ fullscreenImageViewer: true }, '');
    }
    pushedHistoryRef.current = true;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Best-effort real fullscreen — silently no-ops where unsupported
    // (notably iOS Safari before 16.4) since the CSS rotate below already
    // makes the image read as landscape and fill the viewport regardless.
    containerRef.current
      ?.requestFullscreen?.()
      .then(() => { enteredFullscreen = true; })
      .catch(() => {});

    return () => {
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.body.style.overflow = prevOverflow;
      enteredFullscreen = false;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [close]);

  return (
    <div data-ti="components/FullscreenImageViewer.tsx"
      ref={containerRef}
      className="fixed inset-0 z-[2000] flex items-center justify-center overflow-hidden bg-black"
      onClick={close}
    >
      <button
        onClick={close}
        aria-label="Close full screen view"
        className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border-2 border-white bg-black/70 px-5 py-3 text-lg font-bold text-white hover:bg-black"
        style={{ marginTop: 'env(safe-area-inset-top)', marginRight: 'env(safe-area-inset-right)' }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-6 w-6" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Close
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- object URL, not an optimizable static/remote asset */}
      <img
        src={src}
        alt={alt}
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
