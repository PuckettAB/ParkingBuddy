const CACHE_NAME = "gh-cache-v2";
const OFFLINE_URLS = ["/", "/index.html", "/parking.js"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(OFFLINE_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // For navigations (page loads, including ?garage=...), always serve index.html from cache
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("/index.html").then(cached => {
        return cached || fetch(req);
      })
    );
    return;
  }

  // For everything else (JS, icons, etc.), try cache first, then network
  event.respondWith(
    caches.match(req).then(cached => {
      return cached || fetch(req);
    })
  );
});
