// AFJ CAS Service Worker
// Bump this version string whenever this file changes, so the cache-cleanup in
// 'activate' actually purges entries cached under the old worker.
const CACHE_NAME = 'afj-cas-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Lets the page force this worker to activate immediately instead of waiting
// for the next navigation — paired with the controllerchange reload in
// ServiceWorkerRegistration.tsx so installed PWAs pick up new deploys promptly.
self.addEventListener('message', (messageEvent) => {
  if (messageEvent.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Network-first strategy: always try network, fall back to cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
