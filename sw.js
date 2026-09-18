// Rounding Helper service worker — what makes "Works offline" true.
//
// Modern syntax on purpose: any browser that runs a service worker at all
// supports async/await, so the ES5 style the app uses buys nothing here.
//
// The page is fetched network-first. That is the whole safety story: a new
// build lands on the very next load, so a stale app can never stick, which is
// the usual way a service worker ruins a static site. The cached copy answers
// only when the network fails or is slower than NET_TIMEOUT.
//
// Everything here is same-origin. The worker never touches a third-party URL,
// and nothing is sent anywhere.

const VERSION = "v1";
const CACHE = "rounding-" + VERSION;
const PRECACHE = ["./", "./index.html", "./og.png", "./apple-touch-icon.png"];
const NET_TIMEOUT = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Anything off-site is left alone entirely. There should never be any.
  if (url.origin !== self.location.origin) return;

  const isPage = req.mode === "navigate" ||
                 url.pathname === "/" ||
                 url.pathname.endsWith(".html");

  event.respondWith(isPage ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), NET_TIMEOUT);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Offline, or the network is dragging. Fall back to whatever we hold,
    // and to the page itself for a navigation to some other path.
    const hit = (await cache.match(req)) || (await cache.match("./index.html"));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

// Rejecting does not abort the fetch, it just stops us waiting on it. A late
// response still lands in the cache through the put above.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}
