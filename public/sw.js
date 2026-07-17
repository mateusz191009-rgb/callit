/**
 * v8 — minimal service worker: just enough for PWA installability and an
 * offline fallback for navigations. Deliberately tiny and conservative:
 *
 *  - network-first for EVERYTHING (prices must never be stale),
 *  - never touches /api/* or any cross-origin request (Supabase, feeds),
 *  - caches only the app shell ("/") as the offline navigation fallback,
 *  - versioned cache name so a deploy invalidates cleanly.
 */
const CACHE = 'callit-shell-v1';
const SHELL = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Same-origin pages/assets only — never APIs, never third parties.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Network first; the cached shell only when truly offline. Only a
    // navigation to '/' refreshes the shell — caching every page's HTML
    // under the '/' key would make the offline fallback serve whatever
    // page happened to be visited last.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (url.pathname === '/') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/'))
    );
  }
});
