// Minimal service worker: keeps the app shell available offline. API reads are
// cached separately by the app (IndexedDB), so requests to /api are left alone.
const CACHE = "dyarium-shell-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (
          response.ok &&
          (request.mode === "navigate" ||
            url.pathname.startsWith("/assets/") ||
            url.pathname.startsWith("/ort/"))
        ) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = (await cache.match(request)) || (await cache.match("/"));
        if (cached) {
          return cached;
        }
        throw error;
      }
    }),
  );
});
