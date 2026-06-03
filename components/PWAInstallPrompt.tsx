'use client';
import { useEffect, useState } from 'react';

type Platform = 'ios' | 'android' | 'desktop' | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'pwa-install-dismissed';

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
  // null = hidden; non-null = visible with the detected platform
  const [platform, setPlatform] = useState<Platform>(null);
  const [showIOSSteps, setShowIOSSteps] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // Single setState call avoids the "cascading setState in effect" lint rule
    setPlatform(detectPlatform());

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setPlatform(null);
    setShowIOSSteps(false);
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') dismiss();
    } else {
      setShowIOSSteps(true);
    }
  };

  if (!platform) return null;

  return (
    <div className="bg-[#1e3a5f] text-white px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-3 max-w-lg mx-auto">
        <div className="flex-1 min-w-0">
          {!showIOSSteps ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <p className="font-semibold leading-snug">
                Install this app on your {platform === 'ios' ? 'iPhone/iPad' : platform === 'android' ? 'Android' : 'device'} for the best experience
              </p>
              <button
                onClick={handleInstallClick}
                className="shrink-0 self-start rounded-md bg-white px-3 py-1.5 text-sm font-bold text-[#1e3a5f] hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-white"
              >
                {platform === 'ios' ? 'How to install' : 'Install'}
              </button>
            </div>
          ) : (
            <div>
              <p className="font-semibold mb-2">Install on iPhone / iPad:</p>
              <ol className="space-y-1 list-none">
                <li className="flex items-start gap-2">
                  <span className="text-base leading-snug">1.</span>
                  <span>
                    Tap the{' '}
                    <span className="inline-flex items-center gap-0.5 font-bold">
                      Share{' '}
                      {/* iOS share icon — box with up-arrow */}
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
                  <span className="text-base leading-snug">2.</span>
                  <span>Scroll down and tap <span className="font-bold">Add to Home Screen</span></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-base leading-snug">3.</span>
                  <span>Tap <span className="font-bold">Add</span> — done!</span>
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
