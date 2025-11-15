self.addEventListener("install", e => {
  e.waitUntil(
    caches.open("gh-cache").then(cache => {
      return cache.addAll(["/", "/index.html", "/parking.js"]);
    })
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  );
});