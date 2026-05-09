/* SmartShape Pro Service Worker v2 — offline-first shell + background sync */
const CACHE_VERSION = 'ssp-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const OFFLINE_URL = '/offline.html';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only intercept same-origin requests — never proxy cross-origin API calls
  if (url.origin !== self.location.origin) return;

  // Only intercept GET — mutations are handled by the app's offline queue
  if (req.method !== 'GET') return;

  // Navigation → network-first, fallback to offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // API GETs → stale-while-revalidate (show cached instantly, refresh in bg)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Static assets (JS/CSS/images/fonts) → cache-first
  if (['script', 'style', 'image', 'font'].includes(req.destination)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'ssp-flush-queue') {
    event.waitUntil(notifyClientsToFlush());
  }
});

// Tell all open clients to flush their IndexedDB queue (they hold the credentials)
async function notifyClientsToFlush() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((c) => c.postMessage({ type: 'ssp-sync' }));
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return cached || new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || networkPromise;
}
