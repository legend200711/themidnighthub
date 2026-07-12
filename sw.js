/* ============================================================
   THE MIDNIGHT HUB — sw.js
   Service worker: cache-first for assets, network-first for nav
   ============================================================ */

const CACHE_NAME  = 'midnight-hub-v1';
const OFFLINE_URL = '/themidnighthub/offline.html';

const PRECACHE_ASSETS = [
  '/themidnighthub/',
  '/themidnighthub/index.html',
  '/themidnighthub/offline.html',
  '/themidnighthub/manifest.json',
  '/themidnighthub/icon-192.png',
  '/themidnighthub/icon-512.png',
  '/themidnighthub/apple-touch-icon.png',
  '/themidnighthub/favicon.ico'
];

/* ── Install ─────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate ────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ───────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  /* Skip Firebase, CDN, and cross-origin requests */
  if (url.origin !== location.origin) return;

  /* Navigation requests — network first, offline fallback */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  /* Assets — cache first, update in background */
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(res => {
        if (res && res.status === 200 && isAsset(event.request.url)) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});

/* ── Push notifications ──────────────────────────────────── */
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'The Midnight Hub', {
      body:  data.body  || 'You have a new notification.',
      icon:  '/themidnighthub/icon-192.png',
      badge: '/themidnighthub/icon-192.png',
      data:  { url: data.url || '/themidnighthub/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});

/* ── Helpers ─────────────────────────────────────────────── */
function isAsset(url) {
  return /\.(html|css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/.test(url);
}
