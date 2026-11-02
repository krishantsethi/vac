/* VAXBRIDGE AI service worker.
 *
 * Scope is deliberately narrow:
 *
 *   - Navigations are network-first, falling back to the last good shell. The
 *     app must be reachable on a train with no signal, but must never serve a
 *     stale page when a connection exists.
 *   - Immutable build assets are cache-first; Next fingerprints them, so a new
 *     deploy simply uses new URLs.
 *   - /api/ is NEVER cached. Those responses carry patient data and must always
 *     come from the server or fail loudly. Serving cached clinical data offline
 *     would be worse than showing an error.
 *
 * Offline *capture* is handled separately by an explicit local queue in the app
 * (src/lib/offline.ts) — this worker only keeps the interface available.
 */

const VERSION = "vaxbridge-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/* Precached so the app opens with nothing but the shell. */
const SHELL_URLS = ["/", "/login", "/app", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // Cached individually: one missing URL must not abort the whole install.
        Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isNavigation(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Clinical and account data always goes to the network. A failed request must
  // surface as a failure, not as yesterday's answer.
  if (isApiRequest(url)) return;

  if (isNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          // Fall back to the app shell so navigation still renders something
          // meaningful instead of the browser's offline page.
          const shell = await caches.match("/app");
          if (shell) return shell;
          return new Response(
            "<!doctype html><meta charset=utf-8><title>VAXBRIDGE AI — offline</title>" +
              "<body style='margin:0;background:#07111F;color:#F4F8FC;font-family:system-ui,sans-serif;" +
              "display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px'>" +
              "<div style='max-width:34rem;text-align:center'>" +
              "<h1 style='font-size:1.25rem'>You are offline</h1>" +
              "<p style='color:#A5B6C9;font-size:.875rem;line-height:1.6'>" +
              "The application shell is not cached on this device yet. Doses you captured " +
              "before losing the connection are still stored safely in this browser and will " +
              "sync when you reconnect.</p></div>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        })
    );
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});

/* Lets the page trigger an update as soon as a new worker is installed. */
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
