/**
 * Riziki POS service worker.
 *
 * Its whole job is that no screen goes blank — or hangs. It is deliberately
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
 *  - **Network first, but on a timer.** Stock and prices change with every sale,
 *    so a cached page is a last resort, never a preference. But "the network
 *    failed" and "the network will answer in ninety seconds" feel identical at a
 *    counter with a queue, and a bare `fetch()` waits for the operating system's
 *    timeout before it rejects. So the network gets a couple of seconds; if a
 *    saved copy exists and the network has not answered by then, the saved copy
 *    is served and a fresh one is fetched behind it. This is the whole
 *    difference between "sluggish" and instant on a flaky line.
 *
 *  - **Every main screen is warmed while the phone is online**, so Batch, Stock,
 *    Debts and the rest open offline even if nobody happened to visit them
 *    before the network died. Only visited pages used to be saved, which is why
 *    the counter worked offline and everything else did not.
 *
 *  - **Cache keys drop the query string** for pages, and Next's RSC payloads get
 *    their own key. A client-side navigation asks for `/batch?_rsc=<hash>`, and
 *    that hash changes with every build — matching on the whole URL filled the
 *    cache with payloads nothing would ever ask for again.
 *
 *  - The sync endpoint, the CSV export, the backup and the login page are never
 *    cached. The outbox must always reach the real till; the export and backup
 *    are the owner's live data; the login page must reflect the real session.
 *
 *  - **Cache-first for /_next/static.** Those URLs contain a build hash, so a
 *    cached copy can never be the wrong one, and it is what makes the app shell
 *    paint instantly on a dead connection.
 */

const VERSION = "riziki-v2";
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;

/** Enough to install to the home screen and paint something on a cold start. */
const PRECACHE = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

const NEVER_CACHE = ["/api/", "/export", "/backup", "/login"];

/**
 * The screens worth having on a dead connection. Warmed after each load while
 * online; whatever the signed-in person may not open (an attendant asking for
 * /batch) redirects, and the guard below refuses to store a redirect.
 */
const WARM_ROUTES = [
  "/",
  "/sell",
  "/stock",
  "/customers",
  "/more",
  "/sales",
  "/day-close",
  "/expenses",
  "/batch",
  "/purchases",
  // The page, not the document inside it. The handbook is ~3 MB, and warming
  // that into every phone in the background would spend the shop's data on
  // something most of them open rarely. Opening it once saves it; after that it
  // is there on a dead line, which is when a stuck attendant most needs it.
  "/handbook",
];

/** How long the network gets when we already hold a usable copy. */
const SLOW_NETWORK_MS = 2500;
/** And when we hold nothing, so waiting is the only option worth taking. */
const NO_FALLBACK_MS = 12000;

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

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  // Lets a new build take over without the staff having to close the app.
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  // Sent by the app shortly after each load, while online.
  if (data.type === "WARM") event.waitUntil(warmRoutes());
});

function isNeverCached(pathname) {
  return NEVER_CACHE.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/** True for the payload Next's client router fetches on a soft navigation. */
function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

/**
 * A stable cache key.
 *
 * Pages are stored per path with the query dropped, so `/stock?q=salt` serves
 * the copy warmed as `/stock`. RSC payloads get their own key so an HTML
 * document can never be handed to the client router, or the reverse.
 */
function cacheKey(request, url) {
  if (isRscRequest(request, url)) return `${url.origin}${url.pathname}?__rsc`;
  if (request.mode === "navigate") return `${url.origin}${url.pathname}`;
  return request.url;
}

/** Next sets Vary on RSC responses; ignoring it keeps offline matching honest. */
const MATCH_OPTS = { ignoreVary: true };

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Only ever store a real answer for the page that was actually asked for.
 *
 * The test is the final path, not `response.redirected`: an expired session
 * sends every page to /login, and an attendant asking for /batch is bounced to
 * /, and storing either under the requested key would serve that wrong page
 * from the cache for as long as the phone stayed offline. Comparing paths says
 * exactly that, and says nothing about the benign redirects Next performs on
 * its own.
 */
function storable(request, response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  if (!response.url) return !response.redirected;
  try {
    return new URL(response.url).pathname === new URL(request.url).pathname;
  } catch {
    return false;
  }
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

  event.respondWith(networkFirst(request, url));
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
async function networkFirst(request, url) {
  const cache = await caches.open(SHELL_CACHE);
  const key = cacheKey(request, url);
  const cached = await cache.match(key, MATCH_OPTS);

  // The browser already knows there is no network. Going to the wire anyway is
  // how a navigation used to take a minute to reach the same answer.
  if (!self.navigator.onLine && cached) return cached;

  try {
    const response = await fetchWithTimeout(request, cached ? SLOW_NETWORK_MS : NO_FALLBACK_MS);
    if (storable(request, response)) cache.put(key, response.clone());
    return response;
  } catch {
    if (cached) {
      // Serve the saved copy now; try again behind it so the next tap is fresh.
      // The screen's own "as of" stamp tells the counter what it is looking at.
      revalidate(request, key);
      return cached;
    }

    // A client-side navigation asks for an RSC payload; if that is missing too,
    // a hard navigation to a cached page is still better than nothing.
    if (request.mode === "navigate") {
      const shell =
        (await cache.match(`${url.origin}/sell`, MATCH_OPTS)) ||
        (await cache.match(`${url.origin}/`, MATCH_OPTS));
      if (shell) return shell;
      return new Response(OFFLINE_PAGE, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    throw new Error("offline and nothing saved for this request");
  }
}

/** Best-effort refresh of a copy just served stale. Never throws. */
function revalidate(request, key) {
  fetch(request)
    .then(async (response) => {
      if (!storable(request, response)) return;
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(key, response);
    })
    .catch(() => {});
}

/**
 * Save every main screen while the connection is good.
 *
 * Sequential on purpose: ten parallel page renders on one small server, fired
 * from a phone that has just finished loading, is a self-inflicted stall.
 */
async function warmRoutes() {
  if (!self.navigator.onLine) return;
  const cache = await caches.open(SHELL_CACHE);

  for (const path of WARM_ROUTES) {
    try {
      const url = new URL(path, self.location.origin);
      const request = new Request(url, {
        credentials: "same-origin",
        headers: { "x-riziki-warm": "1" },
      });
      const response = await fetchWithTimeout(request, 8000);
      if (!storable(request, response)) continue;
      await cache.put(`${url.origin}${url.pathname}`, response);
    } catch {
      // A route that will not warm is simply not available offline. Keep going.
    }
  }
}

/** Shown only when the phone is offline AND nothing at all has been cached yet. */
const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Riziki POS — offline</title>
<style>
  body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#0d2b30;background:#f2f7f7;
       display:flex;min-height:100dvh;align-items:center;justify-content:center;padding:1.5rem}
  .box{max-width:22rem;text-align:center}
  .mark{width:3rem;height:3rem;margin:0 auto 1rem;border-radius:.9rem;background:#0b3a40;color:#fff;
        display:flex;align-items:center;justify-content:center;font-weight:800}
  h1{font-size:1.15rem;margin:0 0 .5rem}
  p{margin:0 0 1rem;color:#47646a;font-size:.9rem}
  a{display:inline-block;background:#0e7c86;color:#fff;text-decoration:none;
    padding:.75rem 1.25rem;border-radius:999px;font-weight:700}
</style></head>
<body><div class="box">
  <div class="mark">RZ</div>
  <h1>No connection yet</h1>
  <p>This screen has not been opened on this phone before, so there is nothing saved to show.
     Any sale you already saved is still safe and will send itself when the network is back.</p>
  <a href="/sell">Go to the counter</a>
</div></body></html>`;
