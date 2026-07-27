/* MSMI 2026 service worker.
   Bump CACHE_VERSION on every deploy — that's what forces old precached
   files to be dropped in activate(). This worker never reads or writes
   localStorage; it only manages the Cache Storage API. */
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'msmi-2026-' + CACHE_VERSION;
const FONT_CACHE_NAME = 'msmi-2026-fonts';

const PRECACHE_URLS = [
  './',
  './index.html',
  './treetops-map.webp',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-1024.png',
  './favicon.ico'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* The browser's preload scanner issues the <link rel="stylesheet"> request
   for this before the SW's fetch handler is wired up on a page's first
   controlled load, so it never round-trips through staleWhileRevalidate
   below. Precaching it directly on install guarantees it's available after
   exactly one online visit, which is what the app requires; the runtime
   handler still keeps it fresh on every later visit. */
const FONT_STYLESHEET_URL = 'https://fonts.googleapis.com/css2?family=Archivo:wght@300&family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap';

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)),
      caches.open(FONT_CACHE_NAME).then(cache =>
        fetch(FONT_STYLESHEET_URL).then(res => {
          if (res && res.ok) return cache.put(FONT_STYLESHEET_URL, res);
        }).catch(() => {})
      )
    ]).then(() => self.skipWaiting())
  );
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
