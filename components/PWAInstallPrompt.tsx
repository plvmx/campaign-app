'use client';
import { useEffect, useState } from 'react';

type Platform = 'ios' | 'android' | 'desktop' | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Bump this key to reset the dismissed state for all users (e.g. after a bug fix).
const DISMISSED_KEY = 'pwa-install-dismissed-v2';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

export default function PWAInstallPrompt() {
  // Lazy initializer runs once on the client — avoids any setState call inside an effect.
  // null = hidden; non-null = visible with the detected platform.
  const [platform, setPlatform] = useState<Platform>(() => {
    if (typeof window === 'undefined') return null;
    if (isStandalone()) return null;
    if (localStorage.getItem(DISMISSED_KEY)) return null;
    return detectPlatform();
  });

  // showInstructions: true once the user asks how to install (iOS always; Android fallback)
  const [showInstructions, setShowInstructions] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Effect is purely for the beforeinstallprompt event listener — no setState here.
  useEffect(() => {
    if (!platform) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [platform]);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setPlatform(null);
    setShowInstructions(false);
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Android/desktop Chrome: trigger the native install dialog
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') dismiss();
    } else {
      // Either iOS (Apple never fires beforeinstallprompt) or the Chrome event
      // hasn't fired yet — show manual instructions appropriate to the platform.
      setShowInstructions(true);
    }
  };

  if (!platform) return null;

  const isIOS = platform === 'ios';
  const isAndroid = platform === 'android';

  return (
    <div className="bg-[#1e3a5f] text-white px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-3 max-w-lg mx-auto">
        <div className="flex-1 min-w-0">
          {!showInstructions ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <p className="font-semibold leading-snug">
                Install this app on your{' '}
                {isIOS ? 'iPhone/iPad' : isAndroid ? 'Android' : 'device'} for
                the best experience — opens full-screen like a native app
              </p>
              <button
                onClick={handleInstallClick}
                className="shrink-0 self-start rounded-md bg-white px-3 py-1.5 text-sm font-bold text-[#1e3a5f] hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-white"
              >
                {isIOS ? 'How to install' : 'Install'}
              </button>
            </div>
          ) : isIOS ? (
            /* ── iOS instructions ── */
            <div>
              <p className="font-semibold mb-2">Install on iPhone / iPad (Safari):</p>
              <ol className="space-y-1 list-none">
                <li className="flex items-start gap-2">
                  <span className="shrink-0">1.</span>
                  <span>
                    Tap the{' '}
                    <span className="inline-flex items-center gap-0.5 font-bold">
                      Share{' '}
                      <svg
                        className="inline-block w-4 h-4 mb-0.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                    </span>{' '}
                    button at the bottom of Safari
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0">2.</span>
                  <span>
                    Scroll down and tap{' '}
                    <span className="font-bold">Add to Home Screen</span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0">3.</span>
                  <span>
                    Tap <span className="font-bold">Add</span> — done!
                  </span>
                </li>
              </ol>
            </div>
          ) : (
            /* ── Android / desktop fallback instructions ── */
            <div>
              <p className="font-semibold mb-2">
                Install on {isAndroid ? 'Android (Chrome)' : 'your browser'}:
              </p>
              <ol className="space-y-1 list-none">
                <li className="flex items-start gap-2">
                  <span className="shrink-0">1.</span>
                  <span>
                    Tap the <span className="font-bold">⋮</span> menu in the
                    top-right corner of Chrome
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0">2.</span>
                  <span>
                    Tap{' '}
                    <span className="font-bold">Add to Home screen</span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0">3.</span>
                  <span>
                    Tap <span className="font-bold">Add</span> — done!
                  </span>
                </li>
              </ol>
            </div>
          )}
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 text-white/70 hover:text-white text-lg leading-none focus:outline-none mt-0.5"
          aria-label="Dismiss install prompt"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
