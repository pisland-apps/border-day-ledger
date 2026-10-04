// Border Day Ledger — offline app-shell cache
// Bump CACHE_NAME (e.g. v1 -> v2) whenever index.html or any file in
// APP_SHELL changes, and upload index.html + sw.js together — otherwise
// returning visitors may keep seeing the old cached version.
//
// This does NOT sync automatically with APP_VERSION / APP_VERSION_DATE
// near the top of app.js (the small version badge shown bottom-right,
// even on the lock screen) — they live in different files. Bump BOTH by
// hand on every deploy. See the deploy checklist in README.md.
const CACHE_NAME = 'border-day-ledger-cache-v29';

// './index.html' is deliberately NOT in this list. Cloudflare Pages
// 301/308-redirects /index.html -> / (it strips the .html extension), so
// cache.addAll() below would silently follow that redirect and cache the
// result under the './index.html' key with redirected:true baked into the
// Response. Chrome refuses to answer a navigation with a redirected
// Response from a service worker (fails with net::ERR_FAILED) — which is
// exactly what broke the installed-app shortcut, since it always relaunches
// at the literal /index.html URL. './' is the one canonical entry for the
// app shell's HTML; see the navigate-mode branch in the fetch handler below,
// which resolves ALL navigations through './' regardless of the exact path
// requested (covers old /index.html bookmarks/shortcuts too).
const APP_SHELL = [
  './',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './lib/pdf.min.mjs',
  './lib/pdf.worker.min.mjs',
  './lib/jszip.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// v28: only the app-shell files themselves are ever written to the cache
// (exact URLs, no query-string variants, no redirected or opaque responses),
// the offline fallback can never be `undefined` (that made respondWith throw),
// and requests to other origins are not intercepted at all — the CSP already
// blocks them (connect-src / script-src 'self').
const SHELL_URLS = new Set(APP_SHELL.map((p) => new URL(p, self.location).href));

function shellCacheable(url, res){
  return !!res && res.ok && !res.redirected && res.type === 'basic' && SHELL_URLS.has(url.href);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  // Navigations (address-bar loads, installed-shortcut relaunches, links) are
  // always resolved through the canonical './' cache entry — see the APP_SHELL
  // comment above for why './index.html' is not cached.
  if(req.mode === 'navigate'){
    event.respondWith(
      caches.match('./').then((cached) => {
        const network = fetch('./').then((res) => {
          if(res && res.ok && !res.redirected){
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./', resClone));
          }
          return res;
        }).catch(() => cached || Response.error());
        return cached || network;
      })
    );
    return;
  }

  // app shell: cache-first, refreshed in the background when online
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if(shellCacheable(url, res)){
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      }).catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
