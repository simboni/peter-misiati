// Minimal service worker: enables install ("Add to Home Screen" / TWA) and a
// graceful offline screen. Intentionally does NOT cache app pages or API calls
// so authenticated content is never served stale.
const OFFLINE = "/offline.html";
const CACHE = "tallypay-shell-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Only handle top-level navigations; let everything else hit the network.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
  }
});
