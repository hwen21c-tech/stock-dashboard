// Service Worker for Yeonolang Stock Dashboard PWA (Live Real-time Force Network)
// 2026-11-18: 활성화 시 캐시 정리를 '이 앱(관제탑)' 접두사로 한정한다.
//   같은 오리진을 쓰는 다른 앱(포켓몬 배틀 월드·카드팩·eBook·사주)의 캐시는 절대 건드리지 않는다.
//   이전에는 caches.keys() 전체를 삭제해 다른 앱의 오프라인 셸까지 날렸다.
const PREFIX = 'yeonolang-terminal-';
const CACHE_NAME = PREFIX + 'v24';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
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
