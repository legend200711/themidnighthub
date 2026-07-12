/* Legend Chat Pro — Service Worker */
const CACHE = "legend-chat-v1";
const PRECACHE = [
  "/legend chat.html",
  "/legend-chat-manifest.json",
  "/wolf.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon.ico"
];

/* Install — cache core assets */
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

/* Activate — drop old caches */
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch — network first, fall back to cache */
self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;

  /* Firebase / remote requests — network only, never cache */
  const url = e.request.url;
  if(url.includes("firebasedatabase") || url.includes("gstatic.com")) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if(res && res.status === 200){
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
