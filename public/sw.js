// Service worker for the Wallace St shopping kiosk PWA.
//
// Wall iPad uses this daily; brief WiFi blips (router reboots, firmware
// updates) shouldn't blank the screen mid-shop. Without a SW, any drop
// during navigation kicks Safari to its "no internet" page.
//
// Strategy:
//   - Pre-cache the app shell on install (index.html, manifest, icons).
//   - Navigations: network-first (fresh deploy on next reload),
//     cached shell as offline fallback.
//   - Static assets (icons, manifest): cache-first.
//   - /api/* requests: pass through (never cache live list state, never
//     mask a failed add/remove with a stale 2xx).
//   - skipWaiting + clients.claim: new versions take over immediately.
//
// VERSION: bump when modifying SW logic. Content changes to index.html
// / icons don't require a bump because network-first navigation
// fetches the latest on every reload — the cache is purely the offline
// fallback. Bumping ensures stale caches from old SW logic are nuked
// in the activate handler.

const VERSION = '2026-05-27.1';
const CACHE_NAME = `ha-shopping-${VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: 'reload' });
        if (resp.ok) await cache.put(url, resp);
      } catch { /* best effort */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('ha-shopping-') && k !== CACHE_NAME)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') return;

  // /api/* — never cache. Live list state must always be authoritative;
  // a cached 200 for a todo add/remove would silently mask a real failure.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('/', fresh.clone());
        }
        return fresh;
      } catch {
        const cached =
          (await caches.match('/')) ||
          (await caches.match('/index.html'));
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const resp = await fetch(request);
    if (resp.ok && resp.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, resp.clone());
    }
    return resp;
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
