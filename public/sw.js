// Service worker for the Wallace St shopping kiosk PWA (the React app in
// app/ since 2026-10-10; hashed /assets/* are cached on first fetch).
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

const VERSION = '2026-10-26.1';
const CACHE_NAME = `ha-shopping-${VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
  '/icon.svg',
];

// The React build's code lives in hashed /assets/* files whose names change
// every deploy, so they can't be listed above. Read them out of the page
// itself and cache them alongside it; otherwise the first visit (made before
// this worker controls the page) leaves the offline fallback a blank shell.
async function cacheAssetsOf(cache, html) {
  const urls = [...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) || [])];
  await Promise.all(urls.map(async (u) => {
    if (await cache.match(u)) return;
    try {
      const r = await fetch(u);
      if (r.ok) await cache.put(u, r);
    } catch { /* best effort */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: 'reload' });
        if (resp.ok) {
          if (url === '/') await cacheAssetsOf(cache, await resp.clone().text());
          await cache.put(url, resp);
        }
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

  // /classic/ — the previous app, kept as a fallback after the 2026-10-10
  // cutover. Leave it to the network: otherwise its navigations would be
  // cached as '/', the offline fallback for the current app.
  if (url.pathname.startsWith('/classic/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('/', fresh.clone());
          // A new deploy brings new asset names: cache them now, while online.
          fresh.clone().text().then((html) => cacheAssetsOf(cache, html));
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
