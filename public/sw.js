// Minimal service worker: exists to satisfy PWA install criteria and give
// the app a static offline fallback, not to cache data or pages. Every page
// in this app (deck, mod view, shelf, preferences, ...) is force-dynamic and
// rendered per-session: theme, role, and channel branding are all baked into
// the server-rendered HTML itself, not fetched separately. Caching that HTML
// under its URL and replaying it on a network hiccup — which is exactly what
// this worker used to do — meant a mod could get served a stale render from
// a DIFFERENT channel or session (e.g. the newsprint-default shell cached at
// install time, before any theme was ever set) the moment their connection
// blipped mid-navigation, most commonly right when switching channels. So:
// navigations are always network-only, falling back to a static, genuinely
// non-personalized offline page — never a cached copy of a real page.
const CACHE = 'broadside-shell-v3';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL]).catch(() => {})),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // Page navigations: every page is dynamic and session-specific, so this
  // must never serve (or store) anything but a live network response.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Only content-hashed build assets are safe to cache: identical for every
  // user and never reused across builds. Everything else passes straight
  // through — in particular client-side route changes, which are NOT
  // navigations but fetch()es of the per-session RSC payload (`?_rsc=…`,
  // `RSC: 1` header). Caching those and replaying one on a network blip or
  // aborted request handed the router a stale payload from another build or
  // session, which crashed into the global error page mid-navigation.
  if (!url.pathname.startsWith('/_next/static/') && !url.pathname.startsWith('/icons/')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || Response.error())),
  );
});
