// Offline support. The whole app is precached on install; after that it
// loads from the cache and quietly checks for a newer version.
// Bump VERSION whenever any file below changes.

const VERSION = 'tally-v7.0.0';

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
  './icons/screenshots/narrow-home.png',
  './icons/screenshots/wide-home.png',
  './js/app.js',
  './js/store.js',
  './js/storage.js',
  './js/notify.js',
  './js/prices.js',
  './js/valuation.js',
  './js/vault.js',
  './js/core/advisor.js',
  './js/core/dates.js',
  './js/core/defaults.js',
  './js/core/fund.js',
  './js/core/holdings.js',
  './js/core/money.js',
  './js/core/plans.js',
  './js/core/validate.js',
  './js/ui/charts.js',
  './js/ui/format.js',
  './js/ui/html.js',
  './js/ui/overlay.js',
  './js/ui/posture.js',
  './js/views/chrome.js',
  './js/views/forms.js',
  './js/views/fund.js',
  './js/views/ledger.js',
  './js/views/pots.js',
  './js/views/review.js',
  './js/views/settings.js',
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

// ---------- Being told ----------

// A push arrives whether or not the book is open, which is the whole point:
// the figures move on days you don't think to look. Android will not deliver
// a silent one, so every push shows something worth reading.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Tally';
  const options = {
    body: payload.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: payload.tag || 'tally-daily',
    // A second reading on the same day replaces the first rather than
    // stacking, the same rule the book itself keeps for readings.
    renotify: false,
    data: { url: payload.url || '#/fund' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping it opens the book rather than a new copy of it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '#/fund', self.location.href).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});
