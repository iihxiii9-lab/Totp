// sw.js — FitPulse service worker.
//
// Caching strategy overview:
//  - App shell (HTML/CSS/JS/manifest/icons): precached on install (Cache First at runtime).
//  - Navigations: Network First, falling back to the cached shell, then to offline.html.
//  - Google Fonts: Stale-While-Revalidate in a dedicated cache (fonts rarely change,
//    but we don't want a stale font blocking a real update forever).
//
// Bump CACHE_VERSION whenever precached files change, so old caches get cleaned up
// and clients are notified a new version is ready (see "update available" toast in app.js).

const CACHE_VERSION = "v2";
const SHELL_CACHE = `fitpulse-shell-${CACHE_VERSION}`;
const FONT_CACHE = "fitpulse-fonts";
const OFFLINE_URL = "offline.html";

const PRECACHE_URLS = [
  "./",
  "index.html",
  "offline.html",
  "manifest.json",
  "css/style.css",
  "js/data.js",
  "js/app.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

/* ---------------------------------------------------------
   Install — precache the app shell.
   --------------------------------------------------------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE_URLS);
      // Don't auto-activate; wait for the user to accept the "update available" toast,
      // unless there's no existing controller (first install), in which case activate now.
      if (!self.registration.active) self.skipWaiting();
    })()
  );
});

/* ---------------------------------------------------------
   Activate — clean up old cache versions, take control.
   --------------------------------------------------------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("fitpulse-shell-") && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------------------------------------------------------
   Message — allow the page to trigger skipWaiting() after
   the user taps "Reload" on the update toast.
   --------------------------------------------------------- */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/* ---------------------------------------------------------
   Fetch — route by request type.
   --------------------------------------------------------- */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigations (HTML pages): Network First -> cached shell -> offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Google Fonts: Stale-While-Revalidate.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // Same-origin static assets (css/js/icons/manifest): Cache First.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

/* ---------------------------------------------------------
   Strategies
   --------------------------------------------------------- */
async function networkFirstNavigation(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    return cached || (await cache.match(OFFLINE_URL));
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}
