/* PrepaidPro service worker: offline app shell + last-known balance. */
const VERSION = 'prepaidpro-v1.0.5';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/state.js',
  '/js/api.js',
  '/js/i18n.js',
  '/js/format.js',
  '/js/ui.js',
  '/js/charts.js',
  '/js/views/dashboard.js',
  '/js/views/meters.js',
  '/js/views/usage.js',
  '/js/views/insights.js',
  '/js/views/settings.js',
  '/js/views/onboarding.js',
  '/js/lib/forecast.js',
  '/js/lib/alarm.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API responses: network first, fall back to the last successful response
  // so the last known balance is still visible without internet.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ ok: false, error: { code: 'OFFLINE', message: 'You are offline.' } }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }),
    );
    return;
  }

  // App shell: network first, so a new deploy shows up on the very next open
  // instead of one visit later. If the network is slow (a sleeping free server)
  // or offline, fall back to the cached copy after 3 seconds.
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const network = fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
        return response;
      });
      const cached = await cache.match(request);
      if (!cached) return network;
      const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 3000));
      return Promise.race([network.catch(() => cached), timeout]);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) return existing.focus();
      return self.clients.openWindow('/#/dashboard');
    }),
  );
});
