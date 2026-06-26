'use client';
import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Reload once a new worker takes control, so an already-open tab/installed PWA
    // picks up the new deploy's assets instead of silently running stale ones.
    // Installed PWAs especially can sit on a backgrounded process for a long time
    // without a real network navigation, so this is the main way they self-heal.
    let hasReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hasReloaded) return;
      hasReloaded = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('SW registered:', reg.scope);

        // If a new worker is already waiting (e.g. install happened in a prior
        // visit), activate it now rather than waiting for the next deploy.
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && reg.waiting) {
              reg.waiting.postMessage('SKIP_WAITING');
            }
          });
        });

        // Installed PWAs can resume from a backgrounded state without a network
        // request, so explicitly re-check for an update whenever the app regains
        // focus instead of waiting for the browser's own update schedule.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update();
        });
      })
      .catch((err) => console.error('SW registration failed:', err));
  }, []);

  return null;
}
