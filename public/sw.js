// Minimal service worker: exists to satisfy PWA install criteria and give
// the app shell an offline fallback, not to cache data. API routes are never
// cached — a live triage queue must always show fresh state.
const CACHE = 'broadside-shell-v1';
const SHELL_URLS = ['/mod'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => {})),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first: try the network, cache a copy of successful GETs for the
// shell, and only fall back to the cache (or the /mod shell) if the network
// fails entirely — e.g. a dead spot on a phone mid-triage.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/mod'))),
  );
});
