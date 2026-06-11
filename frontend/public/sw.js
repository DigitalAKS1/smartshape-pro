/* SmartShape Pro Service Worker v2 — offline-first shell + background sync */
const CACHE_VERSION = 'ssp-v10';
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
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
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

  // Navigation → network-first; on failure fall back to the cached app shell
  // (so SPA routes like /settings still load & route client-side), then the
  // offline page. Always resolve to a Response so respondWith never rejects.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req)
          .then((r) => r || caches.match('/index.html'))
          .then((r) => r || caches.match(OFFLINE_URL))
          .then((r) => r || Response.error())
      )
    );
    return;
  }

  // API GETs → network-first; fall back to cache ONLY for non-auth endpoints
  if (url.pathname.startsWith('/api/')) {
    const authSensitive = ['/api/auth/', '/api/notifications', '/api/analytics/', '/api/today/'];
    const isAuthSensitive = authSensitive.some(p => url.pathname.startsWith(p));
    if (isAuthSensitive) {
      // Pass straight to network — never cache auth/notification data
      // On network failure, let it fail naturally (don't return synthetic 503)
      event.respondWith(
        fetch(req).catch(() => new Response(JSON.stringify({ detail: 'Offline' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        }))
      );
    } else {
      event.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // Static assets (JS/CSS/images/fonts) → cache-first
  if (['script', 'style', 'image', 'font'].includes(req.destination)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Other same-origin GETs: network-first, then cache. Resolve to a network-error
  // Response on failure instead of a second un-caught fetch() — a rejecting
  // respondWith() turns a transient failure into a hard SW network error and an
  // "Uncaught (in promise)" rejection.
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || Response.error()))
  );
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
    // Don't hide real HTTP errors — return them so the app handles auth/errors
    return res;
  }).catch(() => {
    // Only use stale cache on genuine network failure (no internet)
    return cached || fetch(req); // retry once, then let it fail naturally
  });
  return cached || networkPromise;
}

// ── Push notification receiver ─────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'SmartShape Pro';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/today' },
    tag: data.tag || 'ssp-general',
    renotify: true,
    vibrate: [200, 100, 200],
    requireInteraction: false,
    actions: [
      { action: 'open', title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification tap → open / focus the app at the right URL ──────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = (event.notification.data && event.notification.data.url) || '/today';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wcs) => {
      for (const c of wcs) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
