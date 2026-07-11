const CACHE_NAME = 'midnight-hub-v1';
const OFFLINE_URL = '/themidnighthub/offline.html';

const PRECACHE_ASSETS = [
  '/themidnighthub/',
  '/themidnighthub/index.html',
  '/themidnighthub/offline.html',
  '/themidnighthub/style.css',
  '/themidnighthub/script.js',
  '/themidnighthub/manifest.json',
  '/themidnighthub/icon-192.png',
  '/themidnighthub/icon-512.png',
  '/themidnighthub/apple-touch-icon.png',
  '/themidnighthub/favicon.ico'
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching assets');
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (Firebase, etc.)
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Serve from cache; update cache in background (stale-while-revalidate)
        const fetchPromise = fetch(event.request)
          .then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse.clone());
              });
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);
        return cachedResponse;
      }

      // Not in cache — try network
      return fetch(event.request)
        .then(networkResponse => {
          // Cache successful responses for HTML, CSS, JS, images, fonts
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            isAssetRequest(event.request)
          ) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('', { status: 408, statusText: 'Offline' });
        });
    })
  );
});

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'The Midnight Hub';
  const options = {
    body: data.body || 'You have a new notification.',
    icon: '/themidnighthub/icon-192.png',
    badge: '/themidnighthub/icon-192.png',
    data: { url: data.url || '/themidnighthub/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/themidnighthub/')
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function isAssetRequest(request) {
  const url = request.url;
  return (
    url.endsWith('.html') ||
    url.endsWith('.css') ||
    url.endsWith('.js') ||
    url.endsWith('.png') ||
    url.endsWith('.jpg') ||
    url.endsWith('.jpeg') ||
    url.endsWith('.gif') ||
    url.endsWith('.webp') ||
    url.endsWith('.ico') ||
    url.endsWith('.svg') ||
    url.endsWith('.woff') ||
    url.endsWith('.woff2') ||
    url.endsWith('.ttf')
  );
}
