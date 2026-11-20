/* =========================================================
   service-worker.js — offline support
   Strategy: precache the whole app shell on install, then
   serve cache-first. The app has no network data at all, so
   once installed it never needs the network again.
   To ship an update: change any file AND bump CACHE_VERSION.
   The app shows "An update is ready → Reload".
   ========================================================= */
const CACHE_VERSION = 'v1.1.0';
const CACHE = `memory-trainer-${CACHE_VERSION}`;

// Relative URLs so the app works from a sub-path (e.g. GitHub Pages /memory-trainer/)
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/theme-boot.js',
  './js/app.js',
  './js/db.js',
  './js/srs.js',
  './js/study.js',
  './js/stats.js',
  './js/charts.js',
  './js/markdown.js',
  './js/ui.js',
  './js/sample-deck.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' bypasses the HTTP cache so a new version gets fresh files
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
  );
  // First install activates immediately; later updates wait for the user to tap "Reload".
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('memory-trainer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other origins

  // Page navigations: always answer with the cached app shell (hash routing does the rest).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true }).then((hit) => hit || fetch(req))
    );
    return;
  }

  // Static assets: cache-first, fall back to network and store the result.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

// Tapping a reminder notification focuses (or opens) the app on the due-cards session.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL('./index.html#/study?mode=due', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
      return self.clients.openWindow(target);
    })
  );
});
