// Offline support. The whole app is precached on install; after that it
// loads from the cache and quietly checks for a newer version.
// Bump VERSION whenever any file below changes.

const VERSION = 'tally-v1.1.0';

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './fonts/public-sans.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/store.js',
  './js/storage.js',
  './js/core/csv.js',
  './js/core/dates.js',
  './js/core/defaults.js',
  './js/core/money.js',
  './js/core/recurring.js',
  './js/core/stats.js',
  './js/core/validate.js',
  './js/ui/charts.js',
  './js/ui/format.js',
  './js/ui/html.js',
  './js/ui/overlay.js',
  './js/views/activity.js',
  './js/views/budgets.js',
  './js/views/components.js',
  './js/views/forms.js',
  './js/views/home.js',
  './js/views/pages.js',
  './js/views/settings.js',
  './js/views/txForm.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('tally-') && k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const cached = await cache.match('./index.html');
        return cached ?? fetch(request);
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
        return response;
      } catch (err) {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })()
  );
});
