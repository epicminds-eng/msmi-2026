/* MSMI 2026 service worker.
   Bump CACHE_VERSION on every deploy — that's what forces old precached
   files to be dropped in activate(). This worker never reads or writes
   localStorage; it only manages the Cache Storage API.

   STANDING RULE: bump CACHE_VERSION whenever ANY file this app serves
   changes — not just index.html. The fetch handler below cache-firsts
   EVERY same-origin GET request, not only the files listed in
   PRECACHE_URLS, so anything under this site can go stale on a returning
   visitor's device until the version changes. This is exactly how
   install/index.html went stale twice in a row (commits f014911, 713507d):
   it was never even in PRECACHE_URLS, but it still got runtime-cached on
   first visit, and neither commit bumped CACHE_VERSION, so devices kept
   serving the old copy indefinitely. tests/check-cache-freshness.js
   catches this locally — run it before committing.

   Explicitly precached (forced into the cache on install, before any
   device has to hit the network for them):
     ./                  (site root, serves index.html)
     ./index.html
     ./install/index.html
     ./treetops-map.webp
     ./manifest.json
     ./icon-180.png, ./icon-192.png, ./icon-512.png, ./icon-1024.png
     ./favicon.ico
     ./epicminds-light.png, ./epicminds-dark.png

   Cache-first is deliberate and load-bearing — it's what makes the app
   work with no signal at Treetops/Gaylord, verified, and not up for
   revisiting mid-trip. But it does mean the fetch handler has no
   allowlist: it happily runtime-caches ANY same-origin file forever,
   precached or not. Narrowing that (e.g. cache-first only for
   PRECACHE_URLS, network-first everything else) is a real design
   question — just one for after the trip, not touched here.

   APP_VERSION (v2.0.0) is separate and user-facing: it's what the footer
   displays (still requested from here via GET_VERSION, same as always —
   index.html never keeps its own copy). It only changes when deliberately
   bumped, unlike CACHE_VERSION which increments on every commit that
   touches any served file, regardless of whether anything user-visible
   changed. */
const CACHE_VERSION = 'v43';
const APP_VERSION = '2.0.0';
const CACHE_NAME = 'msmi-2026-' + CACHE_VERSION;
const FONT_CACHE_NAME = 'msmi-2026-fonts';

const PRECACHE_URLS = [
  './',
  './index.html',
  './install/index.html',
  './treetops-map.webp',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-1024.png',
  './favicon.ico',
  './epicminds-light.png',
  './epicminds-dark.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* A page never gets controlled by the service worker that's still installing
   it (that's spec behavior, not a bug): render-blocking requests — the font
   <link> AND the @font-face url() files it references — go out as plain
   network calls before activate()/clients.claim() ever runs, so neither one
   reaches staleWhileRevalidate below on a first-ever visit. Precache both
   here so the app is fully offline-capable after exactly one online visit;
   the runtime handler still keeps them fresh on every later visit. The font
   file URLs aren't hardcoded — they're parsed out of the stylesheet itself
   so this keeps working if Google rotates the file hashes. */
const FONT_STYLESHEET_URL = 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,500&display=swap';

function precacheFonts() {
  return caches.open(FONT_CACHE_NAME).then(cache =>
    fetch(FONT_STYLESHEET_URL).then(res => {
      if (!res || !res.ok) return;
      return res.clone().text().then(css => {
        const fileUrls = Array.from(css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g))
          .map(m => m[1]);
        return Promise.all([
          cache.put(FONT_STYLESHEET_URL, res),
          ...fileUrls.map(u => fetch(u).then(fr => {
            if (fr && fr.ok) return cache.put(u, fr);
          }).catch(() => {}))
        ]);
      });
    }).catch(() => {})
  );
}

self.addEventListener('install', event => {
  /* No auto skipWaiting() here — a new worker must sit in "waiting" so the
     page can show the update bar and let the user choose when to activate.
     skipWaiting() only runs in response to the SKIP_WAITING message below. */
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)),
      precacheFonts()
    ])
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  /* the page asks for this rather than index.html keeping its own copy of
     the version string — two constants drift the first time someone bumps
     one and not the other, which has already happened twice on this
     project. As of v2.0.0 this answers with APP_VERSION, not CACHE_VERSION:
     CACHE_VERSION now increments on every commit that touches index.html
     and is no longer meant to be user-visible; APP_VERSION only changes
     when deliberately bumped. */
  if (event.data && event.data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: APP_VERSION });
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(name => name !== CACHE_NAME && name !== FONT_CACHE_NAME)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function isFontRequest(url) {
  return FONT_HOSTS.indexOf(url.hostname) > -1;
}

function staleWhileRevalidate(request) {
  return caches.open(FONT_CACHE_NAME).then(cache =>
    cache.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

function cacheFirst(request) {
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response && response.ok && request.method === 'GET') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    });
  });
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (isFontRequest(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
  }
});
