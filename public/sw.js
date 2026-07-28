/**
 * v25.45 — minimal service worker: just enough for PWA installability and a
 * *usable* offline fallback for navigations. Deliberately tiny and
 * conservative:
 *
 *  - network-first for navigations (prices must never be stale),
 *  - cache-first for /_next/static/** ONLY, which is content-hashed and
 *    immutable — a hit there can never be stale by construction,
 *  - never touches /api/* or any cross-origin request (Supabase, feeds),
 *  - versioned cache names so a deploy invalidates cleanly.
 *
 * Why the static cache exists: v8 precached the app shell ('/') and nothing
 * else, so offline `caches.match('/')` returned HTML whose every stylesheet
 * and JS chunk 404'd — raw unstyled text with no interactivity, which reads
 * as a broken app rather than as "you're offline". The shell is only worth
 * caching together with the assets that make it render.
 */
const SHELL_CACHE = 'callit-shell-v2';
const STATIC_CACHE = 'callit-static-v1';
const KEEP = [SHELL_CACHE, STATIC_CACHE];
const SHELL = ['/'];

/** Chunks accumulate across deploys (the URLs are hashed, so old ones are
 *  never overwritten). Oldest-first eviction keeps the cache bounded — a
 *  full page's worth of assets is well under this. */
const STATIC_MAX_ENTRIES = 240;

async function trimStatic() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  // cache.keys() is insertion-ordered, so the head is the oldest entry.
  for (let i = 0; i < keys.length - STATIC_MAX_ENTRIES; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))
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
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Build output: immutable and content-addressed (/_next/static/chunks,
  // /css, and the self-hosted next/font files under /media). Serving these
  // from cache is what makes the offline shell render as the app instead of
  // as unstyled text — and it makes repeat visits paint without a network
  // round trip. Anything else (images, /brand, the manifest) is left alone.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          // Opaque or failed responses are not worth persisting.
          if (res.ok) {
            const copy = res.clone();
            caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(req, copy))
              .then(trimStatic)
              .catch(() => {});
          }
          return res;
        });
      })
    );
  }
});
