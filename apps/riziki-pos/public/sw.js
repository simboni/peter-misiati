/**
 * Riziki POS service worker.
 *
 * Its whole job is that the counter screen never goes blank. It is deliberately
 * small and hand-written: a build-time SW plugin would need a webpack config,
 * and Turbopack is the bundler here.
 *
 * The rules, and why:
 *
 *  - **GET only.** Every mutation in this app is a POST — server actions post to
 *    the page URL, and the outbox posts to /api/sync. A service worker that
 *    touched those could replay money. So anything that is not a GET falls
 *    straight through to the network, untouched and uncached.
 *
 *  - **Network first for pages.** Stock and prices change with every sale, so a
 *    cached page is a last resort, never a preference. The cache only answers
 *    when the network does not.
 *
 *  - The sync endpoint, the CSV export and the login page are never cached. The
 *    outbox must always reach the real till; the export is the owner's data;
 *    the login page must reflect the real session.
 *
 *  - **Cache-first for /_next/static.** Those URLs contain a build hash, so a
 *    cached copy can never be the wrong one, and it is what makes the app shell
 *    paint instantly on a dead connection.
 */

const VERSION = "riziki-v1";
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;

/** Enough to install to the home screen and paint something on a cold start. */
const PRECACHE = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

const NEVER_CACHE = ["/api/", "/export", "/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      // One bad icon must not stop the worker installing, so each is added
      // separately and failures are ignored.
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// Lets a new build take over without the staff having to close the app.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isNeverCached(pathname) {
  return NEVER_CACHE.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // A mutation is never served from, or written to, the cache.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url.pathname)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

/** Hashed build assets: immutable, so the cached copy is always the right one. */
async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Pages, RSC payloads and images.
 *
 * The pages are `force-dynamic` and answer `no-store`, which is right for a
 * browser and wrong for this shop: on a dead connection the choice is not
 * between fresh and stale, it is between stale and a blank screen with a queue
 * waiting. So the shell is kept anyway — and every screen that shows stock says
 * what time that stock was true as of.
 */
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;

    // Client-side navigation asks for an RSC payload; if that is missing too,
    // a hard navigation to a cached page is still better than nothing.
    if (request.mode === "navigate") {
      const shell = (await cache.match("/sell")) || (await cache.match("/"));
      if (shell) return shell;
      return new Response(OFFLINE_PAGE, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    throw err;
  }
}

/** Shown only when the phone is offline AND nothing at all has been cached yet. */
const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Riziki POS — offline</title>
<style>
  body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#0f172a;background:#f8fafc;
       display:flex;min-height:100dvh;align-items:center;justify-content:center;padding:1.5rem}
  .box{max-width:22rem;text-align:center}
  .mark{width:3rem;height:3rem;margin:0 auto 1rem;border-radius:.9rem;background:#0e7c86;color:#fff;
        display:flex;align-items:center;justify-content:center;font-weight:800}
  h1{font-size:1.15rem;margin:0 0 .5rem}
  p{margin:0 0 1rem;color:#64748b;font-size:.9rem}
  a{display:inline-block;background:#0e7c86;color:#fff;text-decoration:none;
    padding:.75rem 1.25rem;border-radius:.75rem;font-weight:700}
</style></head>
<body><div class="box">
  <div class="mark">RZ</div>
  <h1>No connection yet</h1>
  <p>This screen has not been opened on this phone before, so there is nothing saved to show.
     Any sale you already saved is still safe and will send itself when the network is back.</p>
  <a href="/sell">Try again</a>
</div></body></html>`;
