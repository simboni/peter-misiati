/*
 * The service worker.
 *
 * Written by hand, no Workbox: this needs to be readable by whoever maintains
 * the farm's app next, and the whole policy is thirty lines.
 *
 * What it must get right, in order of how badly it hurts when it is wrong:
 *
 *   1. NEVER touch anything that is not a GET. Every save in this app is a
 *      POST to a Server Action. A service worker that replays or caches those
 *      would duplicate a milking, which is worse than losing one.
 *   2. Pages are network-first. The farm's data changes twice a day and a stale
 *      milk sheet is a wrong milk sheet, so the network always gets first
 *      refusal; the cache is what stands in when there is no signal.
 *   3. Build assets are cache-first. Their URLs contain a content hash, so a
 *      hit is always correct and never needs revalidating — this is what makes
 *      the app open at all with the radio off.
 *   4. Nothing here decides what is saved. The outbox does that, in IndexedDB,
 *      and it works whether or not this file ever runs.
 */

const VERSION = "v1";
const SHELL_CACHE = `dairy-shell-${VERSION}`;
const PAGE_CACHE = `dairy-pages-${VERSION}`;
const ASSET_CACHE = `dairy-assets-${VERSION}`;

/** The least that must be on the phone for the app to say something useful. */
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, not addAll: addAll is all-or-nothing, so one 404 on an
      // icon would leave the phone with no offline page at all.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("dairy-") && !k.endsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Four people share one handset. When a different person signs in, the app
 * tells us to drop the pages cached for the last one — an offline reload must
 * not show Wanjiru the screen Kamau was on.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear-pages") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Rule 1. Server Actions, sign-in, everything that changes something: not ours.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The sign-in screen and the auth endpoints are never cached: a cached
  // person-picker on a shared phone is a wrong answer with a long memory.
  if (url.pathname.startsWith("/login") || url.pathname.startsWith("/api/")) return;

  // Rule 3. Hashed build output — the file at this URL can never change.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Rule 2. Pages: network first, and the last good copy if the network fails.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // Everything else the page asks for — icons, the manifest — is small,
  // rarely changes, and is worth having offline.
  if (url.pathname === "/manifest.webmanifest" || /\.(png|svg|ico|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // A missing image is not worth an error page.
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    // Only successful HTML is worth keeping. Caching a redirect to /login would
    // strand the phone on the sign-in screen for as long as the cache lived.
    if (response.ok && response.type === "basic" && !response.redirected) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: false });
    if (cached) return cached;
    // Same screen, different day: try the page without its query string, so
    // "/milk?date=…&session=EVENING" can still fall back on this morning's copy.
    const loose = await caches.match(request, { ignoreSearch: true });
    if (loose) return loose;
    const offline = await caches.match("/offline.html");
    if (offline) return offline;
    return new Response("You are offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
