// Service Worker for Yeonolang Stock Dashboard PWA (Live Real-time Force Network)
const CACHE_NAME = 'yeonolang-terminal-v16';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// ALWAYS NETWORK-FIRST & NO CACHE FOR HTML
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate' || e.request.url.includes('index.html') || e.request.url.includes('deals.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
